import type { AppConfig } from "../config/index.js";
import { AGENT_KINDS, type AgentKind } from "../orchestration/orchestration.types.js";
import { UnknownAgentError, UnsupportedAgentError } from "./agent-errors.js";
import type { AgentCommandMap } from "./agent-config.js";
import { defaultAgentCommands } from "./agent-config.js";
import { AGENT_DEFINITIONS, type AgentAvailability, type AgentCapabilities } from "./agent-definition.js";
import { defaultAgentProbes, type AgentProbes } from "./agent-probes.js";
import { createCodingAgent } from "./agent.factory.js";
import { claudeArguments } from "./claude-code.runner.js";
import type { AgentExecution, AgentResult, CodingAgent } from "./agent.interface.js";

const KNOWN_AGENTS = new Set<string>(AGENT_KINDS);

export interface ResolvedAgentRuntime {
  agentId: string;
  command: string;
  args: string[];
  workingDirectoryMode: "worktree";
  capabilities: AgentCapabilities;
  checkAvailability(): Promise<AgentAvailability>;
  execute(input: AgentExecution): Promise<AgentResult>;
}

export interface AgentRuntime {
  resolve(agentId: string): ResolvedAgentRuntime;
  defaultAgent(): ResolvedAgentRuntime;
}

export interface AgentRuntimeOptions {
  implemented?: readonly AgentKind[];
  probes?: AgentProbes;
}

export function createAgentRuntime(
  config: Pick<AppConfig, "codingAgent" | "claudeTimeoutMs"> & { commands?: AgentCommandMap },
  options: AgentRuntimeOptions = {},
): AgentRuntime {
  const commands = config.commands ?? defaultAgentCommands();
  const implemented = new Set<string>(options.implemented ?? AGENT_KINDS);
  const probes = options.probes ?? defaultAgentProbes();
  const runners = new Map<AgentKind, CodingAgent>();
  for (const id of AGENT_KINDS) {
    if (implemented.has(id)) {
      runners.set(
        id,
        createCodingAgent(id, {
          command: commands[id].command,
          extraArgs: commands[id].extraArgs,
          timeoutMs: commands[id].timeoutMs ?? config.claudeTimeoutMs,
        }),
      );
    }
  }
  const resolve = (agentId: string): ResolvedAgentRuntime => {
    if (!KNOWN_AGENTS.has(agentId)) {
      throw new UnknownAgentError(agentId);
    }
    const kind = agentId as AgentKind;
    const runner = runners.get(kind);
    if (!runner) {
      throw new UnsupportedAgentError(agentId);
    }
    const command = commands[kind].command;
    const definition = AGENT_DEFINITIONS[kind];
    return {
      agentId,
      command,
      args: launchArguments(kind, commands[kind].extraArgs),
      workingDirectoryMode: "worktree",
      capabilities: definition.capabilities,
      checkAvailability: () => checkAvailability(kind, command, probes),
      execute: (input) => runner.execute(input),
    };
  };
  return {
    resolve,
    defaultAgent: () => resolve(config.codingAgent),
  };
}

export function fixedAgentRuntime(
  agent: Pick<ResolvedAgentRuntime, "execute"> & Partial<ResolvedAgentRuntime>,
): AgentRuntime {
  const resolved: ResolvedAgentRuntime = {
    agentId: agent.agentId ?? "claude",
    command: agent.command ?? "claude",
    args: agent.args ?? [],
    workingDirectoryMode: "worktree",
    capabilities: agent.capabilities ?? AGENT_DEFINITIONS.claude.capabilities,
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

function launchArguments(agentId: AgentKind, extraArgs: string[]): string[] {
  if (agentId === "claude") {
    return claudeArguments(extraArgs);
  }
  if (agentId === "codex") {
    return ["exec", "--sandbox", "workspace-write", "--ask-for-approval", "never", ...extraArgs];
  }
  return ["-p", "--output-format", "text", "--trust", "--sandbox", "enabled", ...extraArgs];
}

async function checkAvailability(
  agentId: AgentKind,
  command: string,
  probes: AgentProbes,
): Promise<AgentAvailability> {
  if (!(await probes.commandExists(command))) {
    return "unavailable";
  }
  if (agentId === "claude") {
    return "available";
  }
  const status = await probes.commandStatus(command, agentId === "codex" ? ["login", "status"] : ["status"]);
  if (status === "missing") {
    return "unavailable";
  }
  if (status === "failed") {
    return "unauthenticated";
  }
  return "available";
}
