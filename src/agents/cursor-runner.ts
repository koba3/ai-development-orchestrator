import { runCommand } from "../utils/command.js";
import { AGENT_DEFINITIONS, type AgentAvailability } from "./agent-definition.js";
import type { AgentExecution, AgentResult, AgentRunner, AgentRunnerOptions } from "./agent.interface.js";
import { defaultAgentProbes, probeAvailability } from "./agent-probes.js";
import { agentEnvironment, runCodingCommand, type CommandRunner } from "./process-runner.js";

const LAUNCH_ARGUMENTS = ["-p", "--output-format", "text", "--trust", "--sandbox", "enabled"];

export function cursorArguments(worktree: string, prompt: string, extraArgs: string[]): string[] {
  return [...LAUNCH_ARGUMENTS, "--workspace", worktree, ...extraArgs, prompt];
}

export class CursorRunner implements AgentRunner {
  readonly agentId = "cursor";
  readonly capabilities = AGENT_DEFINITIONS.cursor.capabilities;

  constructor(
    private readonly options: AgentRunnerOptions,
    private readonly run: CommandRunner = runCommand,
    private readonly env: NodeJS.ProcessEnv = process.env,
  ) {}

  private get command(): string {
    return this.options.command;
  }

  checkAvailability(): Promise<AgentAvailability> {
    return probeAvailability(this.options.probes ?? defaultAgentProbes(), this.command, ["status"]);
  }

  execute(execution: AgentExecution): Promise<AgentResult> {
    return runCodingCommand(this.run, {
      command: this.command,
      args: cursorArguments(execution.worktree, execution.prompt, this.options.extraArgs),
      cwd: execution.worktree,
      env: agentEnvironment(this.env),
      timeoutMs: this.options.timeoutMs,
    });
  }
}
