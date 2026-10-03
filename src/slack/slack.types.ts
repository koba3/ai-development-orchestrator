export interface SlackInboundMessage {
  workspaceId: string;
  channel: string;
  user: string;
  text: string;
  messageTs: string;
  threadTs: string;
}
