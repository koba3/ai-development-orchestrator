import type { AgentAvailability, AgentCapabilities } from "./agent-definition.js";
import type { AgentProbes } from "./agent-probes.js";

export interface AgentExecution {
  taskId: string;
  prompt: string;
  worktree: string;
}

export interface AgentResult {
  success: boolean;
  output: string;
  error: string;
  exitCode: number;
}

export interface CodingAgent {
  execute(options: AgentExecution): Promise<AgentResult>;
}

export interface AgentRunnerOptions {
  command: string;
  extraArgs: string[];
  timeoutMs: number;
  probes?: AgentProbes;
}

export interface AgentRunner extends CodingAgent {
  readonly agentId: string;
  readonly command: string;
  readonly args: string[];
  readonly workingDirectoryMode: "worktree";
  readonly capabilities: AgentCapabilities;
  checkAvailability(): Promise<AgentAvailability>;
}
