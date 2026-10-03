import { runCommand } from "../utils/command.js";
import { AGENT_DEFINITIONS, type AgentAvailability } from "./agent-definition.js";
import type { AgentExecution, AgentResult, AgentRunner, AgentRunnerOptions } from "./agent.interface.js";
import { defaultAgentProbes, probeAvailability } from "./agent-probes.js";
import { agentEnvironment, runCodingCommand, type CommandRunner } from "./process-runner.js";

const LAUNCH_ARGUMENTS = ["exec", "--sandbox", "workspace-write", "--ask-for-approval", "never"];

export function codexArguments(worktree: string, extraArgs: string[]): string[] {
  return [...LAUNCH_ARGUMENTS, "--cd", worktree, ...extraArgs, "-"];
}

export class CodexRunner implements AgentRunner {
  readonly agentId = "codex";
  readonly workingDirectoryMode = "worktree" as const;
  readonly capabilities = AGENT_DEFINITIONS.codex.capabilities;

  constructor(
    private readonly options: AgentRunnerOptions,
    private readonly run: CommandRunner = runCommand,
    private readonly env: NodeJS.ProcessEnv = process.env,
  ) {}

  get command(): string {
    return this.options.command;
  }

  get args(): string[] {
    return [...LAUNCH_ARGUMENTS, ...this.options.extraArgs];
  }

  checkAvailability(): Promise<AgentAvailability> {
    return probeAvailability(this.options.probes ?? defaultAgentProbes(), this.command, ["login", "status"]);
  }

  execute(execution: AgentExecution): Promise<AgentResult> {
    return runCodingCommand(this.run, {
      command: this.command,
      args: codexArguments(execution.worktree, this.options.extraArgs),
      cwd: execution.worktree,
      input: execution.prompt,
      env: agentEnvironment(this.env),
      timeoutMs: this.options.timeoutMs,
    });
  }
}
