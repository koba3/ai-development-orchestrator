import type { AgentKind } from "../orchestration/orchestration.types.js";

export const AGENT_AVAILABILITIES = [
  "unknown",
  "unsupported",
  "unavailable",
  "unauthenticated",
  "available",
] as const;

export type AgentAvailability = (typeof AGENT_AVAILABILITIES)[number];

export interface AgentCapabilities {
  nonInteractive: boolean;
  filesystemWrite: boolean;
  shellExecution: boolean;
  worktree: boolean;
  structuredOutput: boolean;
  permissionPolicy: boolean;
}

export interface AgentDefinition {
  id: AgentKind;
  kind: "coding";
  displayName: string;
  capabilities: AgentCapabilities;
}

const codingCapabilities: AgentCapabilities = {
  nonInteractive: true,
  filesystemWrite: true,
  shellExecution: true,
  worktree: true,
  structuredOutput: false,
  permissionPolicy: true,
};

export const AGENT_DEFINITIONS: Record<AgentKind, AgentDefinition> = {
  claude: { id: "claude", kind: "coding", displayName: "Claude Code", capabilities: codingCapabilities },
  codex: { id: "codex", kind: "coding", displayName: "Codex", capabilities: codingCapabilities },
  cursor: {
    id: "cursor",
    kind: "coding",
    displayName: "Cursor Agent",
    capabilities: codingCapabilities,
  },
};
