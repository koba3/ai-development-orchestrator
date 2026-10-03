import type { CommandRequest, CommandResult } from "../utils/command.js";
import { runCommand } from "../utils/command.js";
import { sanitizeError } from "../utils/errors.js";
import { AgentExecutionError } from "./agent-errors.js";
import type { AgentExecution, AgentResult, CodingAgent } from "./agent.interface.js";

const SECRET_ENV_KEYS = [
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "NOTION_TOKEN",
  "SLACK_BOT_TOKEN",
  "SLACK_APP_TOKEN",
  "SLACK_SIGNING_SECRET",
  "GITHUB_TOKEN",
  "GH_TOKEN",
];

const DISALLOWED_TOOLS = ["Bash(git push*)", "Bash(git commit*)", "Bash(ssh *)", "Bash(scp *)"];

export interface ClaudeCodeOptions {
  command: string;
  extraArgs: string[];
  timeoutMs: number;
}

export type CommandRunner = (request: CommandRequest) => Promise<CommandResult>;

export function agentEnvironment(source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env = { ...source };
  for (const key of SECRET_ENV_KEYS) {
    delete env[key];
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

export function claudeArguments(extraArgs: string[]): string[] {
  return [
    "-p",
    "--output-format",
    "text",
    "--permission-mode",
    "acceptEdits",
    "--permission-prompts",
    "none",
    "--disallowed-tools",
    ...DISALLOWED_TOOLS,
    ...extraArgs,
  ];
}

export class ClaudeCodeRunner implements CodingAgent {
  constructor(
    private readonly options: ClaudeCodeOptions,
    private readonly run: CommandRunner = runCommand,
    private readonly env: NodeJS.ProcessEnv = process.env,
  ) {}

  async execute(execution: AgentExecution): Promise<AgentResult> {
    try {
      const result = await this.run({
        command: this.options.command,
        args: claudeArguments(this.options.extraArgs),
        cwd: execution.worktree,
        input: execution.prompt,
        env: agentEnvironment(this.env),
        timeoutMs: this.options.timeoutMs,
      });
      const output = result.stdout.trim();
      const error = result.exitCode === 0 ? "" : result.stderr.trim() || output || `claude exited ${result.exitCode}`;
      return {
        success: result.exitCode === 0,
        output,
        error,
        exitCode: result.exitCode,
      };
    } catch (error) {
      const failure = new AgentExecutionError(sanitizeError(error).message);
      return {
        success: false,
        output: "",
        error: failure.message,
        exitCode: -1,
      };
    }
  }
}
