import { UnknownAgentError } from "./agent-errors.js";
import type { AgentCommandConfig } from "./agent-config.js";
import type { CodingAgent } from "./agent.interface.js";
import { ClaudeCodeRunner } from "./claude-code.runner.js";
import { CodexRunner } from "./codex-runner.js";
import { CursorRunner } from "./cursor-runner.js";

export interface CreateCodingAgentConfig extends AgentCommandConfig {
  timeoutMs: number;
}

export function createCodingAgent(agentId: string, config: CreateCodingAgentConfig): CodingAgent {
  if (agentId === "claude") {
    return new ClaudeCodeRunner({
      command: config.command,
      extraArgs: config.extraArgs,
      timeoutMs: config.timeoutMs,
    });
  }
  if (agentId === "codex") {
    return new CodexRunner({
      command: config.command,
      extraArgs: config.extraArgs,
      timeoutMs: config.timeoutMs,
    });
  }
  if (agentId === "cursor") {
    return new CursorRunner({
      command: config.command,
      extraArgs: config.extraArgs,
      timeoutMs: config.timeoutMs,
    });
  }
  throw new UnknownAgentError(agentId);
}
