import type { AppConfig } from "../config/index.js";
import { AGENT_KINDS, type AgentKind } from "../orchestration/orchestration.types.js";
import { UnknownAgentError, UnsupportedAgentError } from "./agent-errors.js";
import { createCodingAgent, type CodingAgentConfig } from "./agent.factory.js";
import type { CodingAgent } from "./agent.interface.js";

const KNOWN_AGENTS = new Set<string>(AGENT_KINDS);

export interface AgentRuntime {
  resolve(agentId: string): CodingAgent;
  defaultAgent(): CodingAgent;
}

export function createAgentRuntime(
  config: CodingAgentConfig & Pick<AppConfig, "codingAgent">,
): AgentRuntime {
  const implemented = new Map<AgentKind, CodingAgent>([["claude", createCodingAgent("claude", config)]]);
  return {
    resolve(agentId: string) {
      if (!KNOWN_AGENTS.has(agentId)) {
        throw new UnknownAgentError(agentId);
      }
      const runtime = implemented.get(agentId as AgentKind);
      if (!runtime) {
        throw new UnsupportedAgentError(agentId);
      }
      return runtime;
    },
    defaultAgent() {
      return this.resolve(config.codingAgent);
    },
  };
}

export function fixedAgentRuntime(agent: CodingAgent): AgentRuntime {
  return {
    resolve() {
      return agent;
    },
    defaultAgent() {
      return agent;
    },
  };
}
