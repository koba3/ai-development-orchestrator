import { describe, expect, it } from "vitest";
import pino from "pino";
import type { DevelopmentPlan } from "../src/planning/planner.prompt.js";
import { TaskService, resolveRepository } from "../src/tasks/task.service.js";
import type { NewTask, Task, TaskPatch, TaskStatus } from "../src/tasks/task.types.js";
import type { TaskStore } from "../src/tasks/task.store.js";

const logger = pino({ level: "silent" });

class MemoryTaskStore implements TaskStore {
  readonly tasks: Task[] = [];

  async findBySourceMessage(sourceMessageTs: string, slackChannel: string): Promise<Task[]> {
    return this.tasks.filter(
      (task) => task.sourceMessageTs === sourceMessageTs && task.slackChannel === slackChannel,
    );
  }

  async insert(task: NewTask): Promise<Task> {
    const created = { ...task, notionPageId: `page-${task.taskId}`, notionUrl: `https://notion.local/${task.taskId}` };
    this.tasks.push(created);
    return created;
  }

  async findByStatus(status: TaskStatus): Promise<Task[]> {
    return this.tasks.filter((task) => task.status === status);
  }

  async transition(notionPageId: string, from: TaskStatus, patch: TaskPatch): Promise<Task | null> {
    const task = this.tasks.find((item) => item.notionPageId === notionPageId);
    if (!task || task.status !== from) {
      return null;
    }
    Object.assign(task, patch);
    return { ...task };
  }
}

const plan: DevelopmentPlan = {
  needsHuman: false,
  summary: "顧客一覧にCSV出力を追加",
  humanQuestion: null,
  confidence: 0.92,
  tasks: [
    {
      title: "CSV出力APIを実装",
      description: "管理者だけ",
      agentType: "backend",
      priority: "normal",
      repository: "Questoon",
    },
    {
      title: "CSVボタンを追加",
      description: "顧客一覧画面",
      agentType: "frontend",
      priority: "high",
      repository: null,
    },
  ],
};

describe("resolveRepository", () => {
  it("prefers a path from the plan and otherwise uses the default", () => {
    expect(resolveRepository("/tmp/questoon", "/default")).toBe("/tmp/questoon");
    expect(resolveRepository("Questoon", "/default")).toBe("/default");
    expect(resolveRepository(null, "")).toBe("");
  });
});

describe("TaskService", () => {
  it("creates sibling tasks that share a request and start at the given status", async () => {
    const store = new MemoryTaskStore();
    const service = new TaskService(store, logger, {
      defaultRepository: "/tmp/questoon",
      now: () => new Date("2026-10-03T01:02:03.000Z"),
      createRequestId: () => "REQ-1",
      createTaskId: (() => {
        const ids = ["TASK-102", "TASK-103"];
        return () => ids.shift() ?? "TASK-X";
      })(),
    });
    const created = await service.create({
      plan,
      status: "READY",
      humanQuestion: "",
      slackChannel: "C1",
      slackThreadTs: "111.222",
      sourceMessageTs: "111.222",
    });
    expect(created.map((task) => task.taskId)).toEqual(["TASK-102", "TASK-103"]);
    expect(new Set(created.map((task) => task.requestId))).toEqual(new Set(["REQ-1"]));
    expect(created.every((task) => task.status === "READY" && task.retryCount === 0)).toBe(true);
    expect(created.every((task) => task.repository === "/tmp/questoon")).toBe(true);
    expect(created[0]?.branch).toBe("");
    expect(created[0]?.worktree).toBe("");
  });
});
