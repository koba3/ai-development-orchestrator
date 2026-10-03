import { describe, expect, it } from "vitest";
import { AGENT_TYPES, PRIORITIES, TASK_STATUSES, type NewTask } from "../src/tasks/task.types.js";
import { buildDatabaseProperties, NOTION_PROPS } from "../src/notion/notion.properties.js";
import { fromNotionPage, toNotionProperties } from "../src/notion/notion.mapper.js";

const draft: NewTask = {
  taskId: "TASK-102",
  title: "CSV出力APIを実装",
  description: "管理者だけが使える",
  status: "READY",
  priority: "normal",
  agentType: "backend",
  repository: "/tmp/questoon",
  branch: "",
  worktree: "",
  pullRequestUrl: "",
  result: "",
  error: "",
  createdAt: "2026-10-03T00:00:00.000Z",
  updatedAt: "2026-10-03T00:00:00.000Z",
  retryCount: 0,
  requestId: "REQ-1",
  summary: "顧客CSV",
  slackChannel: "C1",
  slackThreadTs: "111.222",
  sourceMessageTs: "111.222",
  humanQuestion: "",
  confidence: 0.9,
};

describe("notion task schema", () => {
  it("defines every required task field and status", () => {
    const properties = buildDatabaseProperties();
    expect(Object.keys(properties).sort()).toEqual(Object.values(NOTION_PROPS).sort());
    const status = properties[NOTION_PROPS.status] as { select: { options: Array<{ name: string }> } };
    expect(status.select.options.map((option) => option.name)).toEqual([...TASK_STATUSES]);
    const agents = properties[NOTION_PROPS.agentType] as { select: { options: Array<{ name: string }> } };
    expect(agents.select.options.map((option) => option.name)).toEqual([...AGENT_TYPES]);
    const priorities = properties[NOTION_PROPS.priority] as { select: { options: Array<{ name: string }> } };
    expect(priorities.select.options.map((option) => option.name)).toEqual([...PRIORITIES]);
  });

  it("round-trips a task through Notion properties", () => {
    const properties = toNotionProperties(draft);
    const pageProperties = Object.fromEntries(
      Object.entries(properties).map(([name, value]) => {
        const property = value as Record<string, unknown>;
        if (property.title) {
          return [name, { title: [{ plain_text: draft.title }] }];
        }
        if (property.rich_text) {
          const text = (property.rich_text as Array<{ text: { content: string } }>)
            .map((item) => item.text.content)
            .join("");
          return [name, { rich_text: text ? [{ plain_text: text }] : [] }];
        }
        return [name, property];
      }),
    );
    const task = fromNotionPage({
      id: "page-1",
      url: "https://www.notion.so/page-1",
      properties: pageProperties,
    });
    expect(task.taskId).toBe("TASK-102");
    expect(task.status).toBe("READY");
    expect(task.agentType).toBe("backend");
    expect(task.repository).toBe("/tmp/questoon");
    expect(task.retryCount).toBe(0);
    expect(task.notionUrl).toBe("https://www.notion.so/page-1");
    expect(task.pullRequestUrl).toBe("");
  });
});
