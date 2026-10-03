import { AGENT_TYPES, PRIORITIES, TASK_STATUSES } from "../tasks/task.types.js";

export const NOTION_PROPS = {
  title: "Title",
  taskId: "TaskId",
  description: "Description",
  status: "Status",
  priority: "Priority",
  agentType: "AgentType",
  repository: "Repository",
  branch: "Branch",
  worktree: "Worktree",
  pullRequestUrl: "PullRequestUrl",
  result: "Result",
  error: "Error",
  createdAt: "CreatedAt",
  updatedAt: "UpdatedAt",
  retryCount: "RetryCount",
  requestId: "RequestId",
  summary: "Summary",
  slackChannel: "SlackChannel",
  slackThreadTs: "SlackThreadTs",
  sourceMessageTs: "SourceMessageTs",
  humanQuestion: "HumanQuestion",
  confidence: "Confidence",
  workspaceId: "WorkspaceId",
  hashtag: "Hashtag",
  projectId: "ProjectId",
  projectName: "ProjectName",
  repositoryMode: "RepositoryMode",
  localRepository: "LocalRepository",
  remoteRepository: "RemoteRepository",
} as const;

const STATUS_COLORS: Record<(typeof TASK_STATUSES)[number], string> = {
  RECEIVED: "gray",
  PLANNING: "blue",
  READY: "green",
  ASSIGNED: "purple",
  CODING: "yellow",
  TESTING: "orange",
  REVIEWING: "pink",
  NEEDS_HUMAN: "red",
  NEEDS_CHANGES: "brown",
  READY_TO_MERGE: "green",
  DONE: "green",
  FAILED: "red",
};

const PRIORITY_COLORS: Record<(typeof PRIORITIES)[number], string> = {
  low: "gray",
  normal: "blue",
  high: "orange",
  urgent: "red",
};

const AGENT_COLORS: Record<(typeof AGENT_TYPES)[number], string> = {
  backend: "purple",
  frontend: "blue",
  test: "green",
  review: "yellow",
};

function selectProperty(names: readonly string[], colors: Record<string, string>) {
  return {
    select: {
      options: names.map((name) => ({ name, color: colors[name] ?? "default" })),
    },
  };
}

export function buildDatabaseProperties(): Record<string, unknown> {
  return {
    [NOTION_PROPS.title]: { title: {} },
    [NOTION_PROPS.taskId]: { rich_text: {} },
    [NOTION_PROPS.description]: { rich_text: {} },
    [NOTION_PROPS.status]: selectProperty(TASK_STATUSES, STATUS_COLORS),
    [NOTION_PROPS.priority]: selectProperty(PRIORITIES, PRIORITY_COLORS),
    [NOTION_PROPS.agentType]: selectProperty(AGENT_TYPES, AGENT_COLORS),
    [NOTION_PROPS.repository]: { rich_text: {} },
    [NOTION_PROPS.branch]: { rich_text: {} },
    [NOTION_PROPS.worktree]: { rich_text: {} },
    [NOTION_PROPS.pullRequestUrl]: { url: {} },
    [NOTION_PROPS.result]: { rich_text: {} },
    [NOTION_PROPS.error]: { rich_text: {} },
    [NOTION_PROPS.createdAt]: { date: {} },
    [NOTION_PROPS.updatedAt]: { date: {} },
    [NOTION_PROPS.retryCount]: { number: { format: "number" } },
    [NOTION_PROPS.requestId]: { rich_text: {} },
    [NOTION_PROPS.summary]: { rich_text: {} },
    [NOTION_PROPS.slackChannel]: { rich_text: {} },
    [NOTION_PROPS.slackThreadTs]: { rich_text: {} },
    [NOTION_PROPS.sourceMessageTs]: { rich_text: {} },
    [NOTION_PROPS.humanQuestion]: { rich_text: {} },
    [NOTION_PROPS.confidence]: { number: { format: "number" } },
    [NOTION_PROPS.workspaceId]: { rich_text: {} },
    [NOTION_PROPS.hashtag]: { rich_text: {} },
    [NOTION_PROPS.projectId]: { rich_text: {} },
    [NOTION_PROPS.projectName]: { rich_text: {} },
    [NOTION_PROPS.repositoryMode]: { rich_text: {} },
    [NOTION_PROPS.localRepository]: { rich_text: {} },
    [NOTION_PROPS.remoteRepository]: { rich_text: {} },
  };
}
