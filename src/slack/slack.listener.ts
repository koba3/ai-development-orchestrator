import { App } from "@slack/bolt";
import type { AppConfig } from "../config/index.js";
import type { AppLogger } from "../utils/logger.js";
import { sanitizeError } from "../utils/errors.js";
import { extractHumanMessage, readSlackWorkspaceId } from "./extract-message.js";
import type { SlackService } from "./slack.service.js";
import type { SlackInboundMessage } from "./slack.types.js";

export interface MessageHandler {
  handle(message: SlackInboundMessage): Promise<void>;
}

export class SlackListener {
  private readonly app: App;

  constructor(
    private readonly config: Pick<
      AppConfig,
      "slackBotToken" | "slackAppToken" | "slackSigningSecret" | "slackChannelIds"
    >,
    private readonly handler: MessageHandler,
    private readonly slack: SlackService,
    private readonly logger: AppLogger,
  ) {
    this.app = new App({
      token: config.slackBotToken,
      appToken: config.slackAppToken,
      signingSecret: config.slackSigningSecret,
      socketMode: true,
    });
    this.app.message(async ({ message, context, body }) => {
      const workspaceId = readSlackWorkspaceId({
        message,
        contextTeamId: context.teamId,
        envelopeTeamId: typeof body.team_id === "string" ? body.team_id : undefined,
      });
      const inbound = extractHumanMessage(message, this.config.slackChannelIds, workspaceId);
      if (!inbound) {
        return;
      }
      this.logger.info(
        { event: "slack.message.received", status: "RECEIVED" },
        "slack message received",
      );
      try {
        await this.handler.handle(inbound);
      } catch (error) {
        this.logger.error(
          { event: "slack.message.failed", status: "FAILED", error: sanitizeError(error) },
          "slack message handling failed",
        );
        try {
          await this.slack.postMessage({
            channel: inbound.channel,
            threadTs: inbound.threadTs,
            text: "処理中にエラーが発生しました。時間をおいてもう一度送ってください。",
          });
        } catch (notifyError) {
          this.logger.error(
            { event: "slack.reply.failed", status: "FAILED", error: sanitizeError(notifyError) },
            "failed to report message handling error",
          );
        }
      }
    });
    this.app.error(async (error) => {
      this.logger.error(
        { event: "slack.listener.error", status: "FAILED", error: sanitizeError(error) },
        "slack listener error",
      );
    });
  }

  async start(): Promise<void> {
    await this.app.start();
    this.logger.info({ event: "slack.listener.started", status: "READY" }, "slack listener started");
  }

  async stop(): Promise<void> {
    await this.app.stop();
  }
}
