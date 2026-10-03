import type { AppConfig } from "../config/index.js";
import type { CodingAgent } from "./agent.interface.js";
import { createCodingAgent } from "./agent.factory.js";

export interface AgentRuntime {
  resolve(agent: string): CodingAgent;
  defaultAgent(): CodingAgent;
}

export function createAgentRuntime(
  config: Pick<AppConfig, "codingAgent" | "claudeCommand" | "claudeExtraArgs" | "claudeTimeoutMs">,
): AgentRuntime {
  const claude = createCodingAgent(config);
  const agents = new Map<string, CodingAgent>([["claude", claude]]);
  return {
    resolve(agent: string) {
      const runtime = agents.get(agent);
      if (!runtime) {
        throw new Error(`unsupported agent: ${agent}`);
      }
      return runtime;
    },
    defaultAgent() {
      return claude;
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
