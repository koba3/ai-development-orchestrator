import {
  AGENT_TYPES,
  PRIORITIES,
  TASK_STATUSES,
  type NewTask,
  type Task,
} from "../tasks/task.types.js";
import { toRichText } from "../utils/rich-text.js";
import { NOTION_PROPS } from "./notion.properties.js";

type RichTextItem = { plain_text?: string };
type NotionProperty = Record<string, unknown>;

export function toNotionProperties(task: NewTask): Record<string, unknown> {
  return {
    [NOTION_PROPS.title]: { title: toRichText(task.title) },
    [NOTION_PROPS.taskId]: { rich_text: toRichText(task.taskId) },
    [NOTION_PROPS.description]: { rich_text: toRichText(task.description) },
    [NOTION_PROPS.status]: { select: { name: task.status } },
    [NOTION_PROPS.priority]: { select: { name: task.priority } },
    [NOTION_PROPS.agentType]: { select: { name: task.agentType } },
    [NOTION_PROPS.repository]: { rich_text: toRichText(task.repository) },
    [NOTION_PROPS.branch]: { rich_text: toRichText(task.branch) },
    [NOTION_PROPS.worktree]: { rich_text: toRichText(task.worktree) },
    [NOTION_PROPS.pullRequestUrl]: { url: task.pullRequestUrl || null },
    [NOTION_PROPS.result]: { rich_text: toRichText(task.result) },
    [NOTION_PROPS.error]: { rich_text: toRichText(task.error) },
    [NOTION_PROPS.createdAt]: { date: { start: task.createdAt } },
    [NOTION_PROPS.updatedAt]: { date: { start: task.updatedAt } },
    [NOTION_PROPS.retryCount]: { number: task.retryCount },
    [NOTION_PROPS.requestId]: { rich_text: toRichText(task.requestId) },
    [NOTION_PROPS.summary]: { rich_text: toRichText(task.summary) },
    [NOTION_PROPS.slackChannel]: { rich_text: toRichText(task.slackChannel) },
    [NOTION_PROPS.slackThreadTs]: { rich_text: toRichText(task.slackThreadTs) },
    [NOTION_PROPS.sourceMessageTs]: { rich_text: toRichText(task.sourceMessageTs) },
    [NOTION_PROPS.humanQuestion]: { rich_text: toRichText(task.humanQuestion) },
    [NOTION_PROPS.confidence]: { number: task.confidence },
  };
}

function readTextItems(value: unknown): string {
  if (!Array.isArray(value)) {
    return "";
  }
  return value.map((item) => (item as RichTextItem).plain_text ?? "").join("");
}

function readProperty(properties: Record<string, NotionProperty>, name: string): NotionProperty | undefined {
  return properties[name];
}

function readRichText(properties: Record<string, NotionProperty>, name: string): string {
  const property = readProperty(properties, name);
  return readTextItems(property?.rich_text);
}

function readTitle(properties: Record<string, NotionProperty>, name: string): string {
  const property = readProperty(properties, name);
  return readTextItems(property?.title);
}

function readSelect(properties: Record<string, NotionProperty>, name: string): string {
  const property = readProperty(properties, name);
  const select = property?.select;
  if (!select || typeof select !== "object") {
    return "";
  }
  const optionName = (select as { name?: unknown }).name;
  return typeof optionName === "string" ? optionName : "";
}

function readNumber(properties: Record<string, NotionProperty>, name: string): number {
  const property = readProperty(properties, name);
  return typeof property?.number === "number" ? property.number : 0;
}

function readUrl(properties: Record<string, NotionProperty>, name: string): string {
  const property = readProperty(properties, name);
  return typeof property?.url === "string" ? property.url : "";
}

function readDate(properties: Record<string, NotionProperty>, name: string): string {
  const property = readProperty(properties, name);
  const date = property?.date;
  if (!date || typeof date !== "object") {
    return "";
  }
  const start = (date as { start?: unknown }).start;
  return typeof start === "string" ? start : "";
}

function assertEnum<T extends string>(value: string, allowed: readonly T[], label: string): T {
  if ((allowed as readonly string[]).includes(value)) {
    return value as T;
  }
  throw new Error(`Unknown ${label}: ${value}`);
}

export interface NotionPageLike {
  id: string;
  url?: string;
  properties: Record<string, NotionProperty>;
}

export function fromNotionPage(page: NotionPageLike): Task {
  const properties = page.properties;
  return {
    notionPageId: page.id,
    notionUrl: page.url ?? "",
    taskId: readRichText(properties, NOTION_PROPS.taskId),
    title: readTitle(properties, NOTION_PROPS.title),
    description: readRichText(properties, NOTION_PROPS.description),
    status: assertEnum(readSelect(properties, NOTION_PROPS.status), TASK_STATUSES, "task status"),
    priority: assertEnum(readSelect(properties, NOTION_PROPS.priority), PRIORITIES, "priority"),
    agentType: assertEnum(readSelect(properties, NOTION_PROPS.agentType), AGENT_TYPES, "agent type"),
    repository: readRichText(properties, NOTION_PROPS.repository),
    branch: readRichText(properties, NOTION_PROPS.branch),
    worktree: readRichText(properties, NOTION_PROPS.worktree),
    pullRequestUrl: readUrl(properties, NOTION_PROPS.pullRequestUrl),
    result: readRichText(properties, NOTION_PROPS.result),
    error: readRichText(properties, NOTION_PROPS.error),
    createdAt: readDate(properties, NOTION_PROPS.createdAt),
    updatedAt: readDate(properties, NOTION_PROPS.updatedAt),
    retryCount: readNumber(properties, NOTION_PROPS.retryCount),
    requestId: readRichText(properties, NOTION_PROPS.requestId),
    summary: readRichText(properties, NOTION_PROPS.summary),
    slackChannel: readRichText(properties, NOTION_PROPS.slackChannel),
    slackThreadTs: readRichText(properties, NOTION_PROPS.slackThreadTs),
    sourceMessageTs: readRichText(properties, NOTION_PROPS.sourceMessageTs),
    humanQuestion: readRichText(properties, NOTION_PROPS.humanQuestion),
    confidence: readNumber(properties, NOTION_PROPS.confidence),
  };
}

