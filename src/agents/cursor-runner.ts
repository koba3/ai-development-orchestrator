import { runCommand } from "../utils/command.js";
import type { AgentExecution, AgentResult } from "./agent.interface.js";
import { agentEnvironment, type CommandRunner } from "./process-runner.js";
import { runCodingCommand } from "./codex-runner.js";

export interface CursorOptions {
  command: string;
  extraArgs: string[];
  timeoutMs: number;
}

export function cursorArguments(worktree: string, prompt: string, extraArgs: string[]): string[] {
  return [
    "-p",
    "--output-format",
    "text",
    "--trust",
    "--sandbox",
    "enabled",
    "--workspace",
    worktree,
    ...extraArgs,
    prompt,
  ];
}

export class CursorRunner {
  constructor(
    private readonly options: CursorOptions,
    private readonly run: CommandRunner = runCommand,
    private readonly env: NodeJS.ProcessEnv = process.env,
  ) {}

  async execute(execution: AgentExecution): Promise<AgentResult> {
    return runCodingCommand(this.run, {
      command: this.options.command,
      args: cursorArguments(execution.worktree, execution.prompt, this.options.extraArgs),
      cwd: execution.worktree,
      env: agentEnvironment(this.env),
      timeoutMs: this.options.timeoutMs,
    });
  }
}
