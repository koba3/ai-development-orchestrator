import type { CommandRequest, CommandResult } from "../utils/command.js";
import { sanitizeError } from "../utils/errors.js";
import { AgentExecutionError } from "./agent-errors.js";
import type { AgentResult } from "./agent.interface.js";

export type CommandRunner = (request: CommandRequest) => Promise<CommandResult>;

const SECRET_ENV_KEYS = [
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "NOTION_TOKEN",
  "GITHUB_TOKEN",
  "GH_TOKEN",
];

export function agentEnvironment(source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env = { ...source };
  for (const key of Object.keys(env)) {
    if (SECRET_ENV_KEYS.includes(key) || key.startsWith("SLACK_")) {
      delete env[key];
    }
  }
  return env;
}

export function splitCommandArgs(value: string): string[] {
  const args: string[] = [];
  for (const match of value.matchAll(/"([^"]*)"|(\S+)/g)) {
    const token = match[1] ?? match[2];
    if (token) {
      args.push(token);
    }
  }
  return args;
}

export async function runCodingCommand(run: CommandRunner, request: CommandRequest): Promise<AgentResult> {
  try {
    const result = await run(request);
    const output = result.stdout.trim();
    const error = result.exitCode === 0 ? "" : result.stderr.trim() || output || `${request.command} exited ${result.exitCode}`;
    return { success: result.exitCode === 0, output, error, exitCode: result.exitCode };
  } catch (error) {
    const failure = new AgentExecutionError(sanitizeError(error).message);
    return { success: false, output: "", error: failure.message, exitCode: -1 };
  }
}
