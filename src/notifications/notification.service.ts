import type { Task } from "../tasks/task.types.js";
import type { SlackConnectionManager } from "../slack/slack-connection-manager.js";
import type { AppLogger } from "../utils/logger.js";
import { sanitizeError } from "../utils/errors.js";

const SLACK_TEXT_LIMIT = 3500;

export interface TasksCreatedNotice {
  workspaceId: string;
  channel: string;
  threadTs: string;
  summary: string;
  needsHuman: boolean;
  humanQuestion: string;
  projectName?: string;
  tasks: Array<Pick<Task, "taskId" | "title" | "agentType" | "status" | "notionUrl">>;
}

export interface PlanningFailedNotice {
  workspaceId: string;
  channel: string;
  threadTs: string;
}

export interface RouteRejectedNotice {
  workspaceId: string;
  channel: string;
  threadTs: string;
  text: string;
}

export interface Notifier {
  notifyTasksCreated(notice: TasksCreatedNotice): Promise<void>;
  notifyPlanningFailed(notice: PlanningFailedNotice): Promise<void>;
  notifyRouteRejected(notice: RouteRejectedNotice): Promise<void>;
}

export function formatTasksCreatedMessage(notice: TasksCreatedNotice): string {
  const lines: string[] = [];
  if (notice.projectName && notice.projectName.length > 0) {
    lines.push(`Project: ${notice.projectName}`);
  }
  if (notice.needsHuman) {
    lines.push("人間の確認が必要です。タスクは NEEDS_HUMAN のまま保留しています。");
  } else if (notice.projectName && notice.projectName.length > 0) {
    lines.push("Taskを作成しました。");
    lines.push(`Task ID: ${notice.tasks.map((task) => task.taskId).join(", ")}`);
  } else {
    lines.push("依頼をタスクに分解し、Notion に登録しました。");
  }
  lines.push(`要約: ${notice.summary}`);
  if (notice.needsHuman && notice.humanQuestion.length > 0) {
    lines.push(`確認したいこと: ${notice.humanQuestion}`);
  }
  lines.push("", "タスク:");
  for (const task of notice.tasks) {
    lines.push(`- ${task.taskId}: ${task.title}（${task.agentType} / ${task.status}）`);
    if (task.notionUrl.length > 0) {
      lines.push(`  ${task.notionUrl}`);
    }
  }
  return lines.join("\n").slice(0, SLACK_TEXT_LIMIT);
}

export function formatPlanningFailedMessage(): string {
  return "依頼の解析に失敗しました。時間をおいてもう一度送ってください。";
}

export class NotificationService implements Notifier {
  constructor(
    private readonly slack: SlackConnectionManager,
    private readonly logger: AppLogger,
  ) {}

  async notifyTasksCreated(notice: TasksCreatedNotice): Promise<void> {
    try {
      await this.slack.get(notice.workspaceId).postMessage({
        channel: notice.channel,
        threadTs: notice.threadTs,
        text: formatTasksCreatedMessage(notice),
      });
    } catch (error) {
      this.logger.error(
        { event: "notification.failed", status: "FAILED", error: sanitizeError(error) },
        "failed to notify task creation",
      );
      throw error;
    }
  }

  async notifyPlanningFailed(notice: PlanningFailedNotice): Promise<void> {
    await this.slack.get(notice.workspaceId).postMessage({
      channel: notice.channel,
      threadTs: notice.threadTs,
      text: formatPlanningFailedMessage(),
    });
  }

  async notifyRouteRejected(notice: RouteRejectedNotice): Promise<void> {
    await this.slack.get(notice.workspaceId).postMessage({
      channel: notice.channel,
      threadTs: notice.threadTs,
      text: notice.text.slice(0, SLACK_TEXT_LIMIT),
    });
  }
}
