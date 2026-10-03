import { existsSync, readFileSync } from "node:fs";
import { z } from "zod";
import { ConfigError, formatConfigError } from "../config/index.js";
import { AGENT_KINDS, type AgentKind } from "../orchestration/orchestration.types.js";
import { splitCommandArgs } from "./process-runner.js";

export interface AgentCommandConfig {
  command: string;
  extraArgs: string[];
  timeoutMs?: number;
}

export type AgentCommandMap = Record<AgentKind, AgentCommandConfig>;

const DEFAULT_COMMANDS: Record<AgentKind, string> = {
  claude: "claude",
  codex: "codex",
  cursor: "agent",
};

const agentSchema = z.object({
  kind: z.literal("coding"),
  command: z.string().min(1),
  extraArgs: z.string().optional().default(""),
  timeoutMs: z.number().int().positive().optional(),
});

const agentsFileSchema = z.object({
  agents: z.object({
    claude: agentSchema,
    codex: agentSchema,
    cursor: agentSchema,
  }),
});

export function defaultAgentCommands(): AgentCommandMap {
  return {
    claude: { command: DEFAULT_COMMANDS.claude, extraArgs: [] },
    codex: { command: DEFAULT_COMMANDS.codex, extraArgs: [] },
    cursor: { command: DEFAULT_COMMANDS.cursor, extraArgs: [] },
  };
}

export function loadAgentConfig(filePath: string): { commands: AgentCommandMap; missing: boolean } {
  if (!existsSync(filePath)) {
    return { commands: defaultAgentCommands(), missing: true };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(filePath, "utf8")) as unknown;
  } catch {
    throw new ConfigError(`AGENTS_CONFIG is not valid JSON: ${filePath}`);
  }
  const parsed = agentsFileSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ConfigError(`AGENTS_CONFIG is invalid: ${filePath}\n${formatConfigError(parsed.error)}`);
  }
  const commands = defaultAgentCommands();
  for (const id of AGENT_KINDS) {
    const agent = parsed.data.agents[id];
    commands[id] = {
      command: agent.command,
      extraArgs: splitCommandArgs(agent.extraArgs),
      timeoutMs: agent.timeoutMs,
    };
  }
  return { commands, missing: false };
}

export function applyCommandOverrides(
  commands: AgentCommandMap,
  overrides: Partial<Record<AgentKind, string>>,
): AgentCommandMap {
  const next = { ...commands };
  for (const id of AGENT_KINDS) {
    const override = overrides[id]?.trim() ?? "";
    if (override.length > 0) {
      next[id] = { ...next[id], command: override };
    }
  }
  return next;
}
