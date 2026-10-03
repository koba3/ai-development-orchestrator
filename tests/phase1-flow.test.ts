import { describe, expect, it } from "vitest";
import pino from "pino";
import type { DevelopmentPlan } from "../src/planning/planner.prompt.js";
import type { Planner } from "../src/planning/planner.service.js";
import { IntakeService } from "../src/intake/intake.service.js";
import type {
  Notifier,
  PlanningFailedNotice,
  RouteRejectedNotice,
  TasksCreatedNotice,
} from "../src/notifications/notification.service.js";
import { TaskService } from "../src/tasks/task.service.js";
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

class RecordingNotifier implements Notifier {
  readonly created: TasksCreatedNotice[] = [];
  readonly failed: PlanningFailedNotice[] = [];

  async notifyTasksCreated(notice: TasksCreatedNotice): Promise<void> {
    this.created.push(notice);
  }

  async notifyPlanningFailed(notice: PlanningFailedNotice): Promise<void> {
    this.failed.push(notice);
  }

  async notifyRouteRejected(_notice: RouteRejectedNotice): Promise<void> {}
}

const csvPlan: DevelopmentPlan = {
  needsHuman: false,
  summary: "顧客一覧に管理者限定のCSV出力機能を追加",
  humanQuestion: null,
  confidence: 0.93,
  tasks: [
    {
      title: "CSV出力APIを実装",
      description: "管理者だけが顧客CSVを取得できる",
      agentType: "backend",
      priority: "normal",
      repository: null,
    },
    {
      title: "顧客一覧画面にCSVボタンを追加",
      description: "管理者にだけボタンを出す",
      agentType: "frontend",
      priority: "normal",
      repository: null,
    },
    {
      title: "CSV出力と権限チェックのテスト",
      description: "管理者以外は拒否される",
      agentType: "test",
      priority: "normal",
      repository: null,
    },
  ],
};

function createOrchestrator(planner: Planner, store: MemoryTaskStore, notifier: RecordingNotifier) {
  return new IntakeService(
    planner,
    new TaskService(store, logger, {
      defaultRepository: "/tmp/questoon",
      now: () => new Date("2026-10-03T00:00:00.000Z"),
      createRequestId: () => "REQ-1",
      createTaskId: (() => {
        const ids = ["TASK-102", "TASK-103", "TASK-104"];
        return () => ids.shift() ?? "TASK-X";
      })(),
    }),
    notifier,
    logger,
    0.6,
  );
}

const message = {
  channel: "C1",
  user: "U1",
  text: "Questoonに顧客CSV出力を追加して",
  messageTs: "111.222",
  threadTs: "111.222",
};

describe("phase 1 flow", () => {
  it("turns a Slack request into Notion tasks and replies with the task ids", async () => {
    const store = new MemoryTaskStore();
    const notifier = new RecordingNotifier();
    let plannedText = "";
    const orchestrator = createOrchestrator(
      {
        async plan(text: string) {
          plannedText = text;
          return csvPlan;
        },
      },
      store,
      notifier,
    );

    await orchestrator.handle(message);

    expect(plannedText).toContain("Questoonに顧客CSV出力を追加して");
    expect(store.tasks.map((task) => task.status)).toEqual(["READY", "READY", "READY"]);
    expect(store.tasks.map((task) => task.agentType)).toEqual(["backend", "frontend", "test"]);
    expect(notifier.created).toHaveLength(1);
    expect(notifier.created[0]?.tasks.map((task) => task.taskId)).toEqual(["TASK-102", "TASK-103", "TASK-104"]);
    expect(notifier.failed).toHaveLength(0);

    await orchestrator.handle(message);
    expect(store.tasks).toHaveLength(3);
    expect(notifier.created).toHaveLength(1);
  });

  it("replies with the existing tasks after a restart instead of planning again", async () => {
    const store = new MemoryTaskStore();
    let plans = 0;
    const planner: Planner = {
      async plan() {
        plans += 1;
        return csvPlan;
      },
    };
    await createOrchestrator(planner, store, new RecordingNotifier()).handle(message);
    const restarted = new RecordingNotifier();
    await createOrchestrator(planner, store, restarted).handle(message);

    expect(plans).toBe(1);
    expect(store.tasks).toHaveLength(3);
    expect(restarted.created[0]?.tasks.map((task) => task.taskId)).toEqual([
      "TASK-102",
      "TASK-103",
      "TASK-104",
    ]);
  });

  it("holds tasks for a human when the request includes a secret", async () => {
    const store = new MemoryTaskStore();
    const notifier = new RecordingNotifier();
    const orchestrator = createOrchestrator(
      {
        async plan(text: string) {
          return {
            ...csvPlan,
            tasks: [{ ...csvPlan.tasks[0]!, description: text }],
          };
        },
      },
      store,
      notifier,
    );

    await orchestrator.handle({
      ...message,
      messageTs: "333.444",
      text: "このキー sk-abcdefghijklmnopqrstuvwxyz を本番に設定して",
    });

    expect(store.tasks[0]?.status).toBe("NEEDS_HUMAN");
    expect(store.tasks[0]?.description).not.toContain("sk-abcdefghijklmnopqrstuvwxyz");
    expect(notifier.created[0]?.humanQuestion).toContain("秘密情報");
  });

  it("holds a migration request even when the model is confident", async () => {
    const store = new MemoryTaskStore();
    const notifier = new RecordingNotifier();
    const orchestrator = createOrchestrator(
      {
        async plan() {
          return csvPlan;
        },
      },
      store,
      notifier,
    );

    await orchestrator.handle({
      ...message,
      messageTs: "555.666",
      text: "顧客テーブルに migration を追加して",
    });

    expect(store.tasks[0]?.status).toBe("NEEDS_HUMAN");
    expect(notifier.created[0]?.humanQuestion).toContain("migration");
  });

  it("notifies Slack and keeps running when planning fails", async () => {
    const store = new MemoryTaskStore();
    const notifier = new RecordingNotifier();
    const orchestrator = createOrchestrator(
      {
        async plan() {
          throw new Error("model unavailable Bearer sk-abcdefghijklmnopqrstuvwxyz");
        },
      },
      store,
      notifier,
    );

    await expect(orchestrator.handle(message)).resolves.toBeUndefined();
    expect(store.tasks).toHaveLength(0);
    expect(notifier.failed).toEqual([{ channel: "C1", threadTs: "111.222" }]);
    expect(notifier.created).toHaveLength(0);
  });
});
