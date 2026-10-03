import { WebClient } from "@slack/web-api";
import type { AppLogger } from "../utils/logger.js";
import { sanitizeError } from "../utils/errors.js";

export class SlackService {
  private readonly client: WebClient;

  constructor(
    token: string,
    private readonly logger: AppLogger,
  ) {
    this.client = new WebClient(token);
  }

  async postMessage(input: { channel: string; threadTs: string; text: string }): Promise<void> {
    try {
      await this.client.chat.postMessage({
        channel: input.channel,
        thread_ts: input.threadTs,
        text: input.text,
      });
      this.logger.info(
        { event: "slack.reply.sent", status: "DONE" },
        "slack reply sent",
      );
    } catch (error) {
      this.logger.error(
        { event: "slack.reply.failed", status: "FAILED", error: sanitizeError(error) },
        "slack reply failed",
      );
      throw error;
    }
  }
}
