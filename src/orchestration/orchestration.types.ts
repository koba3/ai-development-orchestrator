export const INPUT_SOURCE_TYPES = ["slack", "github", "webhook", "email", "notion"] as const;

export type InputSourceType = (typeof INPUT_SOURCE_TYPES)[number];

export interface InputSource {
  id: string;
  type: InputSourceType;
  name: string;
  enabled: boolean;
  connection: Record<string, string>;
}

export interface OrchestrationInput {
  inputSourceId: string;
  inputType: InputSourceType;
  externalId: string;
  text: string;
  context: {
    workspaceId?: string;
    channelId?: string;
    userId?: string;
    threadId?: string;
  };
  metadata: Record<string, unknown>;
}

export const AGENT_ROLES = ["coding", "test", "review"] as const;

export type AgentRole = (typeof AGENT_ROLES)[number];

export const AGENT_KINDS = ["claude", "codex", "cursor"] as const;

export type AgentKind = (typeof AGENT_KINDS)[number];

export interface ProjectAgentLink {
  projectId: string;
  role: AgentRole;
  agent: AgentKind;
}
