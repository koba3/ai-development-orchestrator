import { runCommand } from "../utils/command.js";
import { AGENT_DEFINITIONS, type AgentAvailability } from "./agent-definition.js";
import type { AgentExecution, AgentResult, AgentRunner, AgentRunnerOptions } from "./agent.interface.js";
import { defaultAgentProbes, probeAvailability } from "./agent-probes.js";
import { agentEnvironment, runCodingCommand, type CommandRunner } from "./process-runner.js";

export { agentEnvironment, splitCommandArgs, type CommandRunner } from "./process-runner.js";

const DISALLOWED_TOOLS = ["Bash(git push*)", "Bash(git commit*)", "Bash(ssh *)", "Bash(scp *)"];

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

export class ClaudeCodeRunner implements AgentRunner {
  readonly agentId = "claude";
  readonly capabilities = AGENT_DEFINITIONS.claude.capabilities;

  constructor(
    private readonly options: AgentRunnerOptions,
    private readonly run: CommandRunner = runCommand,
    private readonly env: NodeJS.ProcessEnv = process.env,
  ) {}

  private get command(): string {
    return this.options.command;
  }

  private get args(): string[] {
    return claudeArguments(this.options.extraArgs);
  }

  checkAvailability(): Promise<AgentAvailability> {
    return probeAvailability(this.options.probes ?? defaultAgentProbes(), this.command);
  }

  execute(execution: AgentExecution): Promise<AgentResult> {
    return runCodingCommand(this.run, {
      command: this.command,
      args: this.args,
      cwd: execution.worktree,
      input: execution.prompt,
      env: agentEnvironment(this.env),
      timeoutMs: this.options.timeoutMs,
    });
  }
}
