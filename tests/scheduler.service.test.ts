import { describe, expect, it } from "vitest";
import pino from "pino";
import type { AgentResult, CodingAgent } from "../src/agents/agent.interface.js";
import type { CommitResult } from "../src/git/git.service.js";
import { SchedulerService, type SchedulerTasks } from "../src/scheduler/scheduler.service.js";
import type { Task, TaskPatch, TaskStatus } from "../src/tasks/task.types.js";

const logger = pino({ level: "silent" });

function readyTask(): Task {
  return {
    taskId: "TASK-102",
    title: "顧客CSV出力を追加",
    description: "顧客一覧からCSVをダウンロードできるようにする。管理者のみ利用可能。",
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
    summary: "csv",
    slackChannel: "C1",
    slackThreadTs: "1",
    sourceMessageTs: "1",
    humanQuestion: "",
    confidence: 0.9,
    notionPageId: "page-1",
    notionUrl: "https://notion.local/page-1",
    workspaceId: "",
    hashtag: "",
    projectId: "",
    projectName: "",
    repositoryMode: "",
    localRepository: "",
    remoteRepository: "",
  };
}

class MemoryTasks implements SchedulerTasks {
  constructor(readonly items: Task[]) {}

  async listByStatus(status: TaskStatus): Promise<Task[]> {
    return this.items.filter((task) => task.status === status).map((task) => ({ ...task }));
  }

  async transition(notionPageId: string, from: TaskStatus, patch: TaskPatch): Promise<Task | null> {
    const task = this.items.find((item) => item.notionPageId === notionPageId);
    if (!task || task.status !== from) {
      return null;
    }
    Object.assign(task, patch);
    return { ...task };
  }
}

function createHarness(
  tasks: MemoryTasks,
  agent: CodingAgent,
  commit?: (worktree: string, message: string) => Promise<CommitResult>,
  projects?: { localPathFor(projectId: string): string | null },
) {
  const worktreeCalls: Array<{ repository: string; taskId: string; projectId: string }> = [];
  const commitCalls: Array<{ worktree: string; message: string }> = [];
  const scheduler = new SchedulerService(
    tasks,
    {
      async create(repository: string, taskId: string, projectId = "") {
        worktreeCalls.push({ repository, taskId, projectId });
        const worktree = projectId.length > 0 ? `/worktrees/${projectId}/${taskId}` : `/worktrees/${taskId}`;
        return { worktree, branch: `feature/${taskId}` };
      },
    },
    {
      async commitIfNeeded(worktree: string, message: string) {
        commitCalls.push({ worktree, message });
        return commit
          ? commit(worktree, message)
          : { committed: true, sha: "abc1234", subject: message, diffStat: " README.md | 1 +" };
      },
    },
    agent,
    logger,
    { enabled: true, intervalMs: 5000, worktreeRoot: "/worktrees" },
    projects,
  );
  return { scheduler, worktreeCalls, commitCalls };
}

describe("SchedulerService", () => {
  it("moves a READY task through ASSIGNED and CODING to DONE with a commit", async () => {
    const tasks = new MemoryTasks([readyTask()]);
    const executions: Array<{ worktree: string; prompt: string }> = [];
    const { scheduler, worktreeCalls, commitCalls } = createHarness(tasks, {
      async execute(options) {
        executions.push({ worktree: options.worktree, prompt: options.prompt });
        return { success: true, output: "README を更新しました", error: "", exitCode: 0 };
      },
    });

    await scheduler.tick();

    expect(worktreeCalls).toEqual([{ repository: "/tmp/questoon", taskId: "TASK-102", projectId: "" }]);
    expect(executions[0]?.worktree).toBe("/worktrees/TASK-102");
    expect(executions[0]?.prompt).toContain("TASK-102");
    expect(commitCalls).toEqual([
      { worktree: "/worktrees/TASK-102", message: "feat(TASK-102): 顧客CSV出力を追加" },
    ]);
    expect(tasks.items[0]?.status).toBe("DONE");
    expect(tasks.items[0]?.branch).toBe("feature/TASK-102");
    expect(tasks.items[0]?.worktree).toBe("/worktrees/TASK-102");
    expect(tasks.items[0]?.result).toContain("abc1234");
    expect(tasks.items[0]?.result).toContain("README を更新しました");

    await scheduler.tick();
    expect(executions).toHaveLength(1);
  });

  it("marks the task FAILED when Claude Code exits non-zero and does not commit", async () => {
    const tasks = new MemoryTasks([readyTask()]);
    const { scheduler, commitCalls } = createHarness(tasks, {
      async execute(): Promise<AgentResult> {
        return { success: false, output: "", error: "tests failed", exitCode: 1 };
      },
    });

    await scheduler.tick();

    expect(tasks.items[0]?.status).toBe("FAILED");
    expect(tasks.items[0]?.error).toContain("tests failed");
    expect(commitCalls).toHaveLength(0);
  });

  it("marks the task FAILED when the repository cannot be prepared", async () => {
    const tasks = new MemoryTasks([readyTask()]);
    let executions = 0;
    const scheduler = new SchedulerService(
      tasks,
      {
        async create() {
          throw new Error("repository does not exist");
        },
      },
      { async commitIfNeeded() { throw new Error("should not commit"); } },
      { async execute() { executions += 1; return { success: true, output: "", error: "", exitCode: 0 }; } },
      logger,
      { enabled: true, intervalMs: 5000, worktreeRoot: "/worktrees" },
    );

    await scheduler.tick();

    expect(executions).toBe(0);
    expect(tasks.items[0]?.status).toBe("FAILED");
    expect(tasks.items[0]?.error).toContain("repository does not exist");
  });

  it("does not run the same task twice while a tick is still in progress", async () => {
    const tasks = new MemoryTasks([readyTask()]);
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let executions = 0;
    const { scheduler } = createHarness(tasks, {
      async execute() {
        executions += 1;
        await gate;
        return { success: true, output: "ok", error: "", exitCode: 0 };
      },
    });

    const first = scheduler.tick();
    const second = scheduler.tick();
    release();
    await Promise.all([first, second]);

    expect(executions).toBe(1);
    expect(tasks.items[0]?.status).toBe("DONE");
  });

  it("does not execute a task that is no longer READY when claimed", async () => {
    let executions = 0;
    const scheduler = new SchedulerService(
      {
        async listByStatus() {
          return [readyTask()];
        },
        async transition() {
          return null;
        },
      },
      { async create() { throw new Error("should not create a worktree"); } },
      { async commitIfNeeded() { throw new Error("should not commit"); } },
      { async execute() { executions += 1; return { success: true, output: "", error: "", exitCode: 0 }; } },
      logger,
      { enabled: true, intervalMs: 5000, worktreeRoot: "/worktrees" },
    );

    await scheduler.tick();
    expect(executions).toBe(0);
  });

  it("uses the project catalog path and ignores a repository written on the task", async () => {
    const task = readyTask();
    task.projectId = "questoon";
    task.repository = "/Users/koba/projects/luno";
    const tasks = new MemoryTasks([task]);
    const executions: string[] = [];
    const { scheduler, worktreeCalls } = createHarness(
      tasks,
      {
        async execute(options) {
          executions.push(options.prompt);
          return { success: true, output: "ok", error: "", exitCode: 0 };
        },
      },
      undefined,
      {
        localPathFor(projectId) {
          return projectId === "questoon" ? "/Users/koba/projects/questoon" : null;
        },
      },
    );

    await scheduler.tick();

    expect(worktreeCalls).toEqual([
      { repository: "/Users/koba/projects/questoon", taskId: "TASK-102", projectId: "questoon" },
    ]);
    expect(executions[0]).toContain("/Users/koba/projects/questoon");
    expect(executions[0]).not.toContain("/Users/koba/projects/luno");
    expect(tasks.items[0]?.worktree).toBe("/worktrees/questoon/TASK-102");
  });

  it("fails a task whose project is not in the catalog", async () => {
    const task = readyTask();
    task.projectId = "missing";
    const tasks = new MemoryTasks([task]);
    const { scheduler, worktreeCalls } = createHarness(tasks, {
      async execute() {
        throw new Error("should not execute");
      },
    }, undefined, { localPathFor() { return null; } });

    await scheduler.tick();

    expect(worktreeCalls).toEqual([]);
    expect(tasks.items[0]?.status).toBe("FAILED");
    expect(tasks.items[0]?.error).toContain("unknown project: missing");
  });
});
