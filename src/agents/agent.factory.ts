import type { AppConfig } from "../config/index.js";
import { UnknownAgentError, UnsupportedAgentError } from "./agent-errors.js";
import type { CodingAgent } from "./agent.interface.js";
import { ClaudeCodeRunner, splitCommandArgs } from "./claude-code.runner.js";

export type CodingAgentConfig = Pick<AppConfig, "claudeCommand" | "claudeExtraArgs" | "claudeTimeoutMs">;

export function createCodingAgent(agentId: string, config: CodingAgentConfig): CodingAgent {
  if (agentId === "claude") {
    return new ClaudeCodeRunner({
      command: config.claudeCommand,
      extraArgs: splitCommandArgs(config.claudeExtraArgs),
      timeoutMs: config.claudeTimeoutMs,
    });
  }
  if (agentId === "codex" || agentId === "cursor") {
    throw new UnsupportedAgentError(agentId);
  }
  throw new UnknownAgentError(agentId);
}
