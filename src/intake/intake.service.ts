import type { AppLogger } from "../utils/logger.js";
import { sanitizeError } from "../utils/errors.js";
import { redactSecrets } from "../utils/redact.js";
import type { Notifier } from "../notifications/notification.service.js";
import type { OrchestrationInput } from "../orchestration/orchestration.types.js";
import type { Orchestration } from "../orchestration/orchestration.js";
import type { TaskService } from "../tasks/task.service.js";
import { decideApproval, detectHumanGate } from "../planning/approval.service.js";
import type { Planner } from "../planning/planner.service.js";
import type { DevelopmentPlan } from "../planning/planner.prompt.js";

const SECRET_FOUND_REASON =
  "依頼に秘密情報が含まれていたため、内容を確認してください。秘密情報はタスクに保存していません。";

export class IntakeService {
  private readonly inFlight = new Map<string, Promise<void>>();
  private readonly completed = new Set<string>();

  constructor(
    private readonly planner: Planner,
    private readonly tasks: TaskService,
    private readonly notifier: Notifier,
    private readonly logger: AppLogger,
    private readonly confidenceThreshold: number,
    private readonly orchestration?: Orchestration,
  ) {}

  handle(input: OrchestrationInput): Promise<void> {
    const workspaceId = input.context.workspaceId ?? "";
    const key = `${workspaceId}:${input.context.channelId ?? ""}:${input.externalId}`;
    if (this.completed.has(key)) {
      return Promise.resolve();
    }
    const existing = this.inFlight.get(key);
    if (existing) {
      return existing;
    }
    const run = this.process(input, key).finally(() => {
      this.inFlight.delete(key);
    });
    this.inFlight.set(key, run);
    return run;
  }

  private async process(input: OrchestrationInput, key: string): Promise<void> {
    const workspaceId = input.context.workspaceId ?? "";
    const channel = input.context.channelId ?? "";
    const threadTs = input.context.threadId ?? input.externalId;
    const redaction = redactSecrets(input.text);
    let persisted = false;
    try {
      const existing = await this.tasks.findBySourceMessage(input.externalId, channel, workspaceId);
      if (existing.length > 0) {
        persisted = true;
        const first = existing[0];
        if (first) {
          await this.notifier.notifyTasksCreated({
            workspaceId,
            channel,
            threadTs,
            summary: first.summary,
            needsHuman: first.status === "NEEDS_HUMAN",
            humanQuestion: first.humanQuestion,
            tasks: existing,
          });
        }
        this.completed.add(key);
        return;
      }

      const connected = this.orchestration ? this.orchestration.connect({ ...input, text: redaction.text }) : null;
      if (connected && !connected.ok) {
        this.logger.info({ event: "project.unresolved", status: "NEEDS_HUMAN" }, "project route unresolved");
        await this.tasks.create({
          plan: holdPlan(redaction.text, connected.message),
          status: "NEEDS_HUMAN",
          humanQuestion: connected.message,
          slackChannel: channel,
          slackThreadTs: threadTs,
          sourceMessageTs: input.externalId,
          workspaceId,
          lockedRepository: "",
        });
        persisted = true;
        await this.notifier.notifyRouteRejected({
          workspaceId,
          channel,
          threadTs,
          text: connected.message,
        });
        this.completed.add(key);
        return;
      }
      const project = connected?.ok ? connected.route : null;
      if (project) {
        this.logger.info({ event: "project.resolved", status: "READY" }, "project route resolved");
      }

      const plan = await this.planner.plan(
        redaction.text,
        project
          ? {
              name: project.projectName,
              repositoryMode: project.repositoryMode,
              localPath: project.localPath,
            }
          : undefined,
      );
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
        slackChannel: channel,
        slackThreadTs: threadTs,
        sourceMessageTs: input.externalId,
        workspaceId,
        route: project ?? undefined,
        lockedRepository: project ? project.localPath : undefined,
      });
      persisted = true;
      await this.notifier.notifyTasksCreated({
        workspaceId,
        channel,
        threadTs,
        summary: plan.summary,
        needsHuman: decision.needsHuman,
        humanQuestion: decision.humanQuestion,
        projectName: project?.projectName,
        tasks: created,
      });
      this.completed.add(key);
    } catch (error) {
      this.logger.error(
        { event: "intake.failed", status: "FAILED", error: sanitizeError(error) },
        "intake failed",
      );
      if (!persisted) {
        await this.notifier.notifyPlanningFailed({
          workspaceId,
          channel,
          threadTs,
        });
        return;
      }
      throw error;
    }
  }
}

function holdPlan(text: string, question: string): DevelopmentPlan {
  const summary = text.replace(/\s+/g, " ").trim().slice(0, 200) || "プロジェクト未確定";
  const description = text.trim().slice(0, 2000) || "対象プロジェクトが未指定です。";
  return {
    needsHuman: true,
    summary,
    humanQuestion: question,
    confidence: 0,
    tasks: [
      {
        title: "プロジェクト指定待ち",
        description,
        agentType: "backend",
        priority: "normal",
        repository: null,
      },
    ],
  };
}
