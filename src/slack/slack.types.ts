export interface SlackInboundMessage {
  channel: string;
  user: string;
  text: string;
  messageTs: string;
  threadTs: string;
}
