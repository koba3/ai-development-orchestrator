import type { SlackInboundMessage } from "./slack.types.js";

const ALLOWED_SUBTYPES = new Set(["file_share", "thread_broadcast"]);

export function stripMentions(text: string): string {
  return text.replace(/<@[A-Z0-9]+>/g, "").replace(/\s+/g, " ").trim();
}

export function extractHumanMessage(
  message: unknown,
  allowedChannelIds: readonly string[],
): SlackInboundMessage | null {
  if (!message || typeof message !== "object") {
    return null;
  }
  const record = message as Record<string, unknown>;
  if (record.type !== "message") {
    return null;
  }
  if (typeof record.bot_id === "string" || record.subtype === "bot_message") {
    return null;
  }
  if (typeof record.subtype === "string" && !ALLOWED_SUBTYPES.has(record.subtype)) {
    return null;
  }
  if (typeof record.channel !== "string" || typeof record.user !== "string" || typeof record.ts !== "string") {
    return null;
  }
  if (allowedChannelIds.length > 0 && !allowedChannelIds.includes(record.channel)) {
    return null;
  }
  if (typeof record.text !== "string") {
    return null;
  }
  const text = stripMentions(record.text);
  if (text.length === 0) {
    return null;
  }
  const threadTs = typeof record.thread_ts === "string" ? record.thread_ts : record.ts;
  return {
    channel: record.channel,
    user: record.user,
    text,
    messageTs: record.ts,
    threadTs,
  };
}
