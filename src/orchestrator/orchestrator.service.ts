import type { AppLogger } from "../utils/logger.js";
import { sanitizeError } from "../utils/errors.js";
import { redactSecrets } from "../utils/redact.js";
import type { Notifier } from "../notifications/notification.service.js";
import type { SlackInboundMessage } from "../slack/slack.types.js";
import type { TaskService } from "../tasks/task.service.js";
import { decideApproval, detectHumanGate } from "./approval.service.js";
import type { Planner } from "./planner.service.js";

const SECRET_FOUND_REASON =
  "依頼に秘密情報が含まれていたため、内容を確認してください。秘密情報はタスクに保存していません。";

export class OrchestratorService {
  private readonly inFlight = new Map<string, Promise<void>>();
  private readonly completed = new Set<string>();

  constructor(
    private readonly planner: Planner,
    private readonly tasks: TaskService,
    private readonly notifier: Notifier,
    private readonly logger: AppLogger,
    private readonly confidenceThreshold: number,
  ) {}

  handle(message: SlackInboundMessage): Promise<void> {
    const key = `${message.channel}:${message.messageTs}`;
    if (this.completed.has(key)) {
      return Promise.resolve();
    }
    const existing = this.inFlight.get(key);
    if (existing) {
      return existing;
    }
    const run = this.process(message, key).finally(() => {
      this.inFlight.delete(key);
    });
    this.inFlight.set(key, run);
    return run;
  }

  private async process(message: SlackInboundMessage, key: string): Promise<void> {
    const redaction = redactSecrets(message.text);
    let persisted = false;
    try {
      const existing = await this.tasks.findBySourceMessage(message.messageTs, message.channel);
      if (existing.length > 0) {
        persisted = true;
        const first = existing[0];
        if (first) {
          await this.notifier.notifyTasksCreated({
            channel: message.channel,
            threadTs: message.threadTs,
            summary: first.summary,
            needsHuman: first.status === "NEEDS_HUMAN",
            humanQuestion: first.humanQuestion,
            tasks: existing,
          });
        }
        this.completed.add(key);
        return;
      }

      const plan = await this.planner.plan(redaction.text);
      const forceReasons = [
        redaction.redacted ? SECRET_FOUND_REASON : "",
        detectHumanGate(redaction.text) ?? "",
      ].filter((reason) => reason.length > 0);
      const decision = decideApproval(plan, this.confidenceThreshold, {
        forceHumanReason: forceReasons.join("\n"),
      });
      const created = await this.tasks.create({
        plan,
        status: decision.status,
        humanQuestion: decision.humanQuestion,
        slackChannel: message.channel,
        slackThreadTs: message.threadTs,
        sourceMessageTs: message.messageTs,
      });
      persisted = true;
      await this.notifier.notifyTasksCreated({
        channel: message.channel,
        threadTs: message.threadTs,
        summary: plan.summary,
        needsHuman: decision.needsHuman,
        humanQuestion: decision.humanQuestion,
        tasks: created,
      });
      this.completed.add(key);
    } catch (error) {
      this.logger.error(
        { event: "orchestrator.failed", status: "FAILED", error: sanitizeError(error) },
        "orchestrator failed",
      );
      if (!persisted) {
        await this.notifier.notifyPlanningFailed({
          channel: message.channel,
          threadTs: message.threadTs,
        });
        return;
      }
      throw error;
    }
  }
}
