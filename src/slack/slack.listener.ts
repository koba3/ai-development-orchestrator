import { App } from "@slack/bolt";
import type { AppLogger } from "../utils/logger.js";
import { sanitizeError } from "../utils/errors.js";
import type { OrchestrationInput } from "../orchestration/orchestration.types.js";
import { extractHumanMessage, readSlackWorkspaceId } from "./extract-message.js";
import type { SlackConnectionManager } from "./slack-connection-manager.js";
import type { ResolvedSlackConnection } from "./slack-connections.js";
import { toOrchestrationInput } from "./slack-input.adapter.js";

export interface MessageHandler {
  handle(input: OrchestrationInput): Promise<void>;
}

export interface SlackMessageArgs {
  message: unknown;
  context: { teamId?: string };
  body: { team_id?: string };
}

export interface SlackSocketApp {
  message(listener: (args: SlackMessageArgs) => Promise<void>): void;
  error(listener: (error: Error) => Promise<void>): void;
  start(): Promise<unknown>;
  stop(): Promise<unknown>;
}

export type SlackAppFactory = (connection: ResolvedSlackConnection) => SlackSocketApp;

export class SlackListener {
  private readonly apps: SlackSocketApp[] = [];

  constructor(
    private readonly connections: readonly ResolvedSlackConnection[],
    private readonly handler: MessageHandler,
    private readonly slack: SlackConnectionManager,
    private readonly logger: AppLogger,
    private readonly createApp: SlackAppFactory = defaultSlackApp,
  ) {
    for (const connection of connections) {
      const app = createApp(connection);
      const workspaceId = connection.workspaceId;
      const poster = slack.get(workspaceId);
      app.message(async ({ message, context, body }) => {
        const eventWorkspaceId = readSlackWorkspaceId({
          message,
          contextTeamId: context.teamId,
          envelopeTeamId: body.team_id,
        });
        if (eventWorkspaceId.length > 0 && eventWorkspaceId !== workspaceId) {
          this.logger.warn(
            { event: "slack.workspace.mismatch", status: "FAILED", workspaceId },
            "slack event workspace does not match the connection",
          );
          return;
        }
        const inbound = extractHumanMessage(message, connection.channelIds, workspaceId);
        if (!inbound) {
          return;
        }
        this.logger.info(
          { event: "slack.message.received", status: "RECEIVED", workspaceId },
          "slack message received",
        );
        try {
          await this.handler.handle(toOrchestrationInput(inbound));
        } catch (error) {
          this.logger.error(
            { event: "slack.message.failed", status: "FAILED", workspaceId, error: sanitizeError(error) },
            "slack message handling failed",
          );
          try {
            await poster.postMessage({
              channel: inbound.channel,
              threadTs: inbound.threadTs,
              text: "処理中にエラーが発生しました。時間をおいてもう一度送ってください。",
            });
          } catch (notifyError) {
            this.logger.error(
              { event: "slack.reply.failed", status: "FAILED", workspaceId, error: sanitizeError(notifyError) },
              "failed to report message handling error",
            );
          }
        }
      });
      app.error(async (error) => {
        this.logger.error(
          { event: "slack.listener.error", status: "FAILED", workspaceId, error: sanitizeError(error) },
          "slack listener error",
        );
      });
      this.apps.push(app);
    }
  }

  async start(): Promise<void> {
    for (const [index, app] of this.apps.entries()) {
      await app.start();
      const connection = this.connections[index];
      if (!connection) {
        continue;
      }
      this.logger.info(
        {
          event: "slack.connection.ready",
          status: "READY",
          workspaceId: connection.workspaceId,
          connectionId: connection.id,
        },
        "slack connection ready",
      );
    }
  }

  async stop(): Promise<void> {
    for (const app of this.apps) {
      await app.stop();
    }
  }
}

function defaultSlackApp(connection: ResolvedSlackConnection): SlackSocketApp {
  const app = new App({
    token: connection.botToken,
    appToken: connection.appToken,
    signingSecret: connection.signingSecret,
    socketMode: true,
  });
  return {
    message(listener) {
      app.message(async ({ message, context, body }) => {
        await listener({
          message,
          context: { teamId: context.teamId },
          body: { team_id: typeof body.team_id === "string" ? body.team_id : undefined },
        });
      });
    },
    error(listener) {
      app.error(async (error) => {
        await listener(error);
      });
    },
    start: () => app.start(),
    stop: () => app.stop(),
  };
}
