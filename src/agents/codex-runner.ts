import type { CommandRequest } from "../utils/command.js";
import { runCommand } from "../utils/command.js";
import { sanitizeError } from "../utils/errors.js";
import { AgentExecutionError } from "./agent-errors.js";
import type { AgentExecution, AgentResult } from "./agent.interface.js";
import { agentEnvironment, type CommandRunner } from "./process-runner.js";

export interface CodexOptions {
  command: string;
  extraArgs: string[];
  timeoutMs: number;
}

export function codexArguments(worktree: string, extraArgs: string[]): string[] {
  return [
    "exec",
    "--sandbox",
    "workspace-write",
    "--ask-for-approval",
    "never",
    "--cd",
    worktree,
    ...extraArgs,
    "-",
  ];
}

export class CodexRunner {
  constructor(
    private readonly options: CodexOptions,
    private readonly run: CommandRunner = runCommand,
    private readonly env: NodeJS.ProcessEnv = process.env,
  ) {}

  async execute(execution: AgentExecution): Promise<AgentResult> {
    return runCodingCommand(this.run, {
      command: this.options.command,
      args: codexArguments(execution.worktree, this.options.extraArgs),
      cwd: execution.worktree,
      input: execution.prompt,
      env: agentEnvironment(this.env),
      timeoutMs: this.options.timeoutMs,
    });
  }
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
