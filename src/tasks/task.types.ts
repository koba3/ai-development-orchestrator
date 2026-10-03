export const TASK_STATUSES = [
  "RECEIVED",
  "PLANNING",
  "READY",
  "ASSIGNED",
  "CODING",
  "TESTING",
  "REVIEWING",
  "NEEDS_HUMAN",
  "NEEDS_CHANGES",
  "READY_TO_MERGE",
  "DONE",
  "FAILED",
] as const;

export type TaskStatus = (typeof TASK_STATUSES)[number];

export const AGENT_TYPES = ["backend", "frontend", "test", "review"] as const;

export type AgentType = (typeof AGENT_TYPES)[number];

export const PRIORITIES = ["low", "normal", "high", "urgent"] as const;

export type Priority = (typeof PRIORITIES)[number];

export interface Task {
  taskId: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: Priority;
  agentType: AgentType;
  repository: string;
  branch: string;
  worktree: string;
  pullRequestUrl: string;
  result: string;
  error: string;
  createdAt: string;
  updatedAt: string;
  retryCount: number;
  requestId: string;
  summary: string;
  slackChannel: string;
  slackThreadTs: string;
  sourceMessageTs: string;
  humanQuestion: string;
  confidence: number;
  workspaceId: string;
  hashtag: string;
  projectId: string;
  projectName: string;
  repositoryMode: string;
  localRepository: string;
  remoteRepository: string;
  notionPageId: string;
  notionUrl: string;
}

export type NewTask = Omit<Task, "notionPageId" | "notionUrl">;

export interface TaskPatch {
  status?: TaskStatus;
  branch?: string;
  worktree?: string;
  result?: string;
  error?: string;
  updatedAt?: string;
}
