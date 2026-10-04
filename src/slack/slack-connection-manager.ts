import type { AppLogger } from "../utils/logger.js";
import type { ResolvedSlackConnection } from "./slack-connections.js";
import { SlackService } from "./slack.service.js";

export interface SlackPoster {
  postMessage(input: { channel: string; threadTs: string; text: string }): Promise<void>;
}

export class SlackConnectionManager {
  private readonly services = new Map<string, SlackPoster>();

  constructor(
    connections: readonly ResolvedSlackConnection[],
    logger: AppLogger,
    createService: (token: string, logger: AppLogger) => SlackPoster = (token, appLogger) =>
      new SlackService(token, appLogger),
  ) {
    for (const connection of connections) {
      this.services.set(connection.workspaceId, createService(connection.botToken, logger));
    }
  }

  get(workspaceId: string): SlackPoster {
    const service = this.services.get(workspaceId);
    if (!service) {
      throw new Error(`unknown slack workspace: ${workspaceId}`);
    }
    return service;
  }
}
