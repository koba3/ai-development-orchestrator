export interface AgentExecution {
  taskId: string;
  prompt: string;
  worktree: string;
}

export interface AgentResult {
  success: boolean;
  output: string;
  error: string;
  exitCode: number;
}

export interface CodingAgent {
  execute(options: AgentExecution): Promise<AgentResult>;
}
