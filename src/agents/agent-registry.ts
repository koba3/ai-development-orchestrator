import { AGENT_KINDS, type AgentKind } from "../orchestration/orchestration.types.js";
import type { AgentCommandMap } from "./agent-config.js";
import { UnknownAgentError, UnsupportedAgentError } from "./agent-errors.js";
import type { AgentRunner, AgentRunnerOptions } from "./agent.interface.js";
import type { AgentProbes } from "./agent-probes.js";
import { ClaudeCodeRunner } from "./claude-code.runner.js";
import { CodexRunner } from "./codex-runner.js";
import { CursorRunner } from "./cursor-runner.js";

const KNOWN_AGENTS = new Set<string>(AGENT_KINDS);

const RUNNER_FACTORIES: Record<AgentKind, (options: AgentRunnerOptions) => AgentRunner> = {
  claude: (options) => new ClaudeCodeRunner(options),
  codex: (options) => new CodexRunner(options),
  cursor: (options) => new CursorRunner(options),
};

export interface AgentRegistryConfig {
  commands: AgentCommandMap;
  timeoutMs: number;
  probes: AgentProbes;
  implemented?: readonly AgentKind[];
}

export interface AgentRegistry {
  resolve(agentId: string): AgentRunner;
}

export function createAgentRegistry(config: AgentRegistryConfig): AgentRegistry {
  const implemented = new Set<string>(config.implemented ?? AGENT_KINDS);
  const runners = new Map<string, AgentRunner>();
  for (const id of AGENT_KINDS) {
    if (!implemented.has(id)) {
      continue;
    }
    const command = config.commands[id];
    runners.set(
      id,
      RUNNER_FACTORIES[id]({
        command: command.command,
        extraArgs: command.extraArgs,
        timeoutMs: command.timeoutMs ?? config.timeoutMs,
        probes: config.probes,
      }),
    );
  }
  return {
    resolve(agentId: string): AgentRunner {
      if (!KNOWN_AGENTS.has(agentId)) {
        throw new UnknownAgentError(agentId);
      }
      const runner = runners.get(agentId);
      if (!runner) {
        throw new UnsupportedAgentError(agentId);
      }
      return runner;
    },
  };
}
