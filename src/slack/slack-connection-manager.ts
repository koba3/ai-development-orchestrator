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
    private readonly logger: AppLogger,
    private readonly createService: (token: string, logger: AppLogger) => SlackPoster = (token, appLogger) =>
      new SlackService(token, appLogger),
  ) {
    this.replace(connections);
  }

  replace(connections: readonly ResolvedSlackConnection[]): void {
    this.services.clear();
    for (const connection of connections) {
      if (connection.enabled === false) {
        continue;
      }
      this.services.set(connection.workspaceId, this.createService(connection.botToken, this.logger));
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
