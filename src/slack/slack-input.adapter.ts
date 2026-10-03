import type { OrchestrationInput } from "../orchestration/orchestration.types.js";
import type { SlackInboundMessage } from "./slack.types.js";

export function toOrchestrationInput(message: SlackInboundMessage): OrchestrationInput {
  return {
    inputSourceId: "",
    inputType: "slack",
    externalId: message.messageTs,
    text: message.text,
    context: {
      workspaceId: message.workspaceId,
      channelId: message.channel,
      userId: message.user,
      threadId: message.threadTs,
    },
    metadata: {},
  };
}
