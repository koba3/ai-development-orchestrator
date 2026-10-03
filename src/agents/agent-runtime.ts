import type { AgentKind } from "../orchestration/orchestration.types.js";
import type { AgentCommandMap } from "./agent-config.js";
import { defaultAgentCommands } from "./agent-config.js";
import type { AgentCapabilities } from "./agent-definition.js";
import { createAgentRegistry } from "./agent-registry.js";
import { defaultAgentProbes, type AgentProbes } from "./agent-probes.js";
import type { AgentRunner } from "./agent.interface.js";

export type ResolvedAgentRuntime = AgentRunner;

export interface AgentRuntime {
  resolve(agentId: string): ResolvedAgentRuntime;
  defaultAgent(): ResolvedAgentRuntime;
}

export interface AgentRuntimeConfig {
  codingAgent: string;
  timeoutMs: number;
  commands?: AgentCommandMap;
}

export interface AgentRuntimeOptions {
  implemented?: readonly AgentKind[];
  probes?: AgentProbes;
}

const FIXED_CAPABILITIES: AgentCapabilities = {
  nonInteractive: true,
  filesystemWrite: true,
  shellExecution: true,
  worktree: true,
  structuredOutput: false,
  permissionPolicy: true,
};

export function createAgentRuntime(config: AgentRuntimeConfig, options: AgentRuntimeOptions = {}): AgentRuntime {
  const registry = createAgentRegistry({
    commands: config.commands ?? defaultAgentCommands(),
    timeoutMs: config.timeoutMs,
    probes: options.probes ?? defaultAgentProbes(),
    implemented: options.implemented,
  });
  return {
    resolve: (agentId) => registry.resolve(agentId),
    defaultAgent: () => registry.resolve(config.codingAgent),
  };
}

export function fixedAgentRuntime(
  agent: Pick<ResolvedAgentRuntime, "execute"> & Partial<ResolvedAgentRuntime>,
): AgentRuntime {
  const resolved: ResolvedAgentRuntime = {
    agentId: agent.agentId ?? "fixed",
    command: agent.command ?? "fixed",
    args: agent.args ?? [],
    workingDirectoryMode: "worktree",
    capabilities: agent.capabilities ?? FIXED_CAPABILITIES,
    checkAvailability: agent.checkAvailability ?? (async () => "available"),
    execute: (input) => agent.execute(input),
  };
  return {
    resolve() {
      return resolved;
    },
    defaultAgent() {
      return resolved;
    },
  };
}
