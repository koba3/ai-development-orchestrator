import type { AppConfig } from "../config/index.js";
import type { CodingAgent } from "./agent.interface.js";
import { ClaudeCodeRunner, splitCommandArgs } from "./claude-code.runner.js";

export function createCodingAgent(
  config: Pick<AppConfig, "codingAgent" | "claudeCommand" | "claudeExtraArgs" | "claudeTimeoutMs">,
): CodingAgent {
  switch (config.codingAgent) {
    case "claude":
      return new ClaudeCodeRunner({
        command: config.claudeCommand,
        extraArgs: splitCommandArgs(config.claudeExtraArgs),
        timeoutMs: config.claudeTimeoutMs,
      });
    default: {
      const unsupported: never = config.codingAgent;
      throw new Error(`Unsupported CODING_AGENT: ${String(unsupported)}`);
    }
  }
}
