import { describe, expect, it } from "vitest";
import pino from "pino";
import type { DevelopmentPlan, PlannerProjectContext } from "../src/planning/planner.prompt.js";
import type { Planner } from "../src/planning/planner.service.js";
import { IntakeService } from "../src/intake/intake.service.js";
import type { Notifier, PlanningFailedNotice, RouteRejectedNotice, TasksCreatedNotice } from "../src/notifications/notification.service.js";
import { Orchestration } from "../src/orchestration/orchestration.js";
import { ProjectRouter } from "../src/routing/project-router.js";
import type { ProjectCatalogFile } from "../src/routing/project.types.js";
import { toOrchestrationInput } from "../src/slack/slack-input.adapter.js";
import { TaskService } from "../src/tasks/task.service.js";
import type { NewTask, Task, TaskStatus } from "../src/tasks/task.types.js";
import type { TaskStore } from "../src/tasks/task.store.js";

const logger = pino({ level: "silent" });

const catalog: ProjectCatalogFile = {
  workspaces: {
    a: {
      id: "T-A",
      name: "Workspace A",
      channels: {
        development: {
          id: "C-DEV-A",
          name: "development",
          hashtags: {
            questoon: { projectId: "questoon" },
            luno: { projectId: "luno" },
          },
        },
      },
    },
  },
  projects: {
    questoon: {
      name: "Questoon",
      repository: { mode: "local", localPath: "/Users/koba/projects/questoon", remoteRepository: "koba3/questoon" },
    },
    luno: {
      name: "LUNO",
      repository: { mode: "local", localPath: "/Users/koba/projects/luno", remoteRepository: "koba3/luno" },
    },
  },
};

class MemoryTaskStore implements TaskStore {
  readonly tasks: Task[] = [];

  async findBySourceMessage(sourceMessageTs: string, slackChannel: string, workspaceId: string): Promise<Task[]> {
    return this.tasks.filter(
      (task) =>
        task.sourceMessageTs === sourceMessageTs &&
        task.slackChannel === slackChannel &&
        task.workspaceId === workspaceId,
    );
  }

  async insert(task: NewTask): Promise<Task> {
    const created = { ...task, notionPageId: `page-${task.taskId}`, notionUrl: "" };
    this.tasks.push(created);
    return created;
  }

  async findByStatus(status: TaskStatus): Promise<Task[]> {
    return this.tasks.filter((task) => task.status === status);
  }

  async transition(): Promise<Task | null> {
    return null;
  }
}

class RecordingNotifier implements Notifier {
  readonly created: TasksCreatedNotice[] = [];
  readonly rejected: RouteRejectedNotice[] = [];

  async notifyTasksCreated(notice: TasksCreatedNotice): Promise<void> {
    this.created.push(notice);
  }

  async notifyPlanningFailed(_notice: PlanningFailedNotice): Promise<void> {}

  async notifyRouteRejected(notice: RouteRejectedNotice): Promise<void> {
    this.rejected.push(notice);
  }
}

const planFromLlm: DevelopmentPlan = {
  needsHuman: false,
  summary: "ログイン",
  humanQuestion: null,
  confidence: 0.9,
  tasks: [
    {
      title: "Google認証",
      description: "ログイン画面に追加する",
      agentType: "backend",
      priority: "normal",
      repository: "/Users/koba/projects/luno",
    },
  ],
};

function createOrchestrator(planner: Planner, store: MemoryTaskStore, notifier: RecordingNotifier) {
  return new IntakeService(
    planner,
    new TaskService(store, logger, { defaultRepository: "/tmp/should-not-win" }),
    notifier,
    logger,
    0.6,
    new Orchestration(catalog, new ProjectRouter(catalog)),
  );
}

describe("project routing flow", () => {
  it("keeps the router repository when the planner outputs another path", async () => {
    const store = new MemoryTaskStore();
    const notifier = new RecordingNotifier();
    let seen: PlannerProjectContext | undefined;
    const orchestrator = createOrchestrator(
      {
        async plan(_text: string, project?: PlannerProjectContext) {
          seen = project;
          return planFromLlm;
        },
      },
      store,
      notifier,
    );

    await orchestrator.handle(toOrchestrationInput({
      workspaceId: "T-A",
      channel: "C-DEV-A",
      user: "U1",
      text: "#questoon /Users/koba/projects/luno にログインを追加",
      messageTs: "1",
      threadTs: "1",
    }));

    expect(seen?.localPath).toBe("/Users/koba/projects/questoon");
    expect(store.tasks[0]?.repository).toBe("/Users/koba/projects/questoon");
    expect(store.tasks[0]?.localRepository).toBe("/Users/koba/projects/questoon");
    expect(store.tasks[0]?.remoteRepository).toBe("koba3/questoon");
    expect(store.tasks[0]?.projectId).toBe("questoon");
    expect(store.tasks[0]?.projectName).toBe("Questoon");
    expect(store.tasks[0]?.workspaceId).toBe("T-A");
    expect(store.tasks[0]?.hashtag).toBe("questoon");
    expect(notifier.created[0]?.projectName).toBe("Questoon");
    expect(store.tasks[0]?.repository).not.toBe("/Users/koba/projects/luno");
  });

  it("does not call the planner when two projects are requested", async () => {
    const store = new MemoryTaskStore();
    const notifier = new RecordingNotifier();
    let planned = 0;
    const orchestrator = createOrchestrator(
      {
        async plan() {
          planned += 1;
          return planFromLlm;
        },
      },
      store,
      notifier,
    );

    await orchestrator.handle(toOrchestrationInput({
      workspaceId: "T-A",
      channel: "C-DEV-A",
      user: "U1",
      text: "#questoon #luno ログイン機能を追加して",
      messageTs: "2",
      threadTs: "2",
    }));

    expect(planned).toBe(0);
    expect(notifier.rejected[0]?.text).toContain("プロジェクトを1つだけ指定してください。");
    expect(store.tasks[0]?.status).toBe("NEEDS_HUMAN");
    expect(store.tasks[0]?.repository).toBe("");
    expect(store.tasks[0]?.repository).not.toContain("/Users");
  });

  it("does not call the planner when no project can be resolved", async () => {
    const store = new MemoryTaskStore();
    const notifier = new RecordingNotifier();
    let planned = 0;
    const orchestrator = createOrchestrator(
      {
        async plan() {
          planned += 1;
          return planFromLlm;
        },
      },
      store,
      notifier,
    );

    await orchestrator.handle(toOrchestrationInput({
      workspaceId: "T-A",
      channel: "C-DEV-A",
      user: "U1",
      text: "/Users/koba/projects/luno を更新して",
      messageTs: "3",
      threadTs: "3",
    }));

    expect(planned).toBe(0);
    expect(notifier.rejected[0]?.text).toContain("対象プロジェクトを指定してください。");
    expect(store.tasks[0]?.status).toBe("NEEDS_HUMAN");
    expect(store.tasks[0]?.repository).toBe("");
    expect(store.tasks[0]?.localRepository).toBe("");
  });
});
