import { describe, expect, it } from "vitest";
import pino from "pino";
import { createAgentRuntime, fixedAgentRuntime, type AgentRuntime } from "../src/agents/agent-runtime.js";
import type { AgentResult, CodingAgent } from "../src/agents/agent.interface.js";
import type { CommitResult } from "../src/git/git.service.js";
import { SchedulerService, type ProjectBinding, type SchedulerTasks } from "../src/scheduler/scheduler.service.js";
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
  projects?: ProjectBinding,
  runtime: AgentRuntime = fixedAgentRuntime(agent),
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
    runtime,
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
      fixedAgentRuntime({ async execute() { executions += 1; return { success: true, output: "", error: "", exitCode: 0 }; } }),
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
      fixedAgentRuntime({ async execute() { executions += 1; return { success: true, output: "", error: "", exitCode: 0 }; } }),
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
        project(projectId) {
          return projectId === "questoon"
            ? { repository: { localPath: "/Users/koba/projects/questoon" } }
            : null;
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
    }, undefined, { project() { return null; } });

    await scheduler.tick();

    expect(worktreeCalls).toEqual([]);
    expect(tasks.items[0]?.status).toBe("FAILED");
    expect(tasks.items[0]?.error).toContain("unknown project: missing");
  });

  it("fails when the project has no coding agent link", async () => {
    const task = readyTask();
    task.projectId = "questoon";
    const tasks = new MemoryTasks([task]);
    const { scheduler, worktreeCalls } = createHarness(
      tasks,
      {
        async execute() {
          throw new Error("should not execute");
        },
      },
      undefined,
      {
        project() {
          return { repository: { localPath: "/Users/koba/projects/questoon" } };
        },
        agentFor() {
          return null;
        },
      },
    );

    await scheduler.tick();

    expect(worktreeCalls).toEqual([]);
    expect(tasks.items[0]?.status).toBe("FAILED");
    expect(tasks.items[0]?.error).toContain("no coding agent linked: questoon");
  });

  it("fails when the linked agent has no runtime", async () => {
    const task = readyTask();
    task.projectId = "questoon";
    const tasks = new MemoryTasks([task]);
    const { scheduler, worktreeCalls } = createHarness(
      tasks,
      {
        async execute() {
          throw new Error("should not execute");
        },
      },
      undefined,
      {
        project() {
          return { repository: { localPath: "/Users/koba/projects/questoon" } };
        },
        agentFor() {
          return { agent: "codex" };
        },
      },
      {
        resolve(agent) {
          throw new Error(`unsupported agent: ${agent}`);
        },
        defaultAgent() {
          throw new Error("should not use the default agent");
        },
      },
    );

    await scheduler.tick();

    expect(worktreeCalls).toEqual([]);
    expect(tasks.items[0]?.status).toBe("FAILED");
    expect(tasks.items[0]?.error).toContain("unsupported agent: codex");
  });

  it("fails a codex project link without falling back to the default agent", async () => {
    const task = readyTask();
    task.projectId = "luno";
    const tasks = new MemoryTasks([task]);
    const { scheduler, worktreeCalls } = createHarness(
      tasks,
      {
        async execute() {
          throw new Error("should not execute");
        },
      },
      undefined,
      {
        project() {
          return { repository: { localPath: "/Users/koba/projects/luno" } };
        },
        agentFor() {
          return { agent: "codex" };
        },
      },
      createAgentRuntime(
        {
          codingAgent: "claude",
          timeoutMs: 1000,
        },
        { probes: { async commandExists() { return false; }, async commandStatus() { return "missing"; } } },
      ),
    );

    await scheduler.tick();

    expect(worktreeCalls).toEqual([]);
    expect(tasks.items[0]?.status).toBe("FAILED");
    expect(tasks.items[0]?.error).toContain("agent codex is unavailable");
  });

  it("fails an unknown agent without using the project repository", async () => {
    const task = readyTask();
    task.projectId = "questoon";
    task.repository = "/Users/koba/projects/luno";
    const tasks = new MemoryTasks([task]);
    const { scheduler, worktreeCalls } = createHarness(
      tasks,
      {
        async execute() {
          throw new Error("should not execute");
        },
      },
      undefined,
      {
        project() {
          return { repository: { localPath: "/Users/koba/projects/questoon" } };
        },
        agentFor() {
          return { agent: "gpt" };
        },
      },
      createAgentRuntime(
        {
          codingAgent: "claude",
          timeoutMs: 1000,
        },
        { probes: { async commandExists() { return false; }, async commandStatus() { return "missing"; } } },
      ),
    );

    await scheduler.tick();

    expect(worktreeCalls).toEqual([]);
    expect(tasks.items[0]?.status).toBe("FAILED");
    expect(tasks.items[0]?.error).toContain("unknown agent: gpt");
    expect(tasks.items[0]?.error).not.toContain("/Users/koba/projects/luno");
  });

  it("runs each project's linked agent in that project's worktree", async () => {
    const executed: string[] = [];
    const runtime: AgentRuntime = {
      resolve(agentId) {
        return {
          agentId,
          command: agentId,
          args: [],
          workingDirectoryMode: "worktree",
          capabilities: {
            nonInteractive: true,
            filesystemWrite: true,
            shellExecution: true,
            worktree: true,
            structuredOutput: false,
            permissionPolicy: true,
          },
          async checkAvailability() {
            return "available";
          },
          async execute(input) {
            executed.push(`${agentId}:${input.worktree}`);
            return { success: true, output: "ok", error: "", exitCode: 0 };
          },
        };
      },
      defaultAgent() {
        return this.resolve("claude");
      },
    };
    const questoon = readyTask();
    questoon.projectId = "questoon";
    questoon.repository = "/tmp/not-used";
    const luno = readyTask();
    luno.taskId = "TASK-200";
    luno.notionPageId = "page-200";
    luno.projectId = "luno";
    luno.repository = "/tmp/also-not-used";
    const tasks = new MemoryTasks([questoon, luno]);
    const { scheduler, worktreeCalls } = createHarness(
      tasks,
      { async execute() { throw new Error("unused"); } },
      undefined,
      {
        project(projectId) {
          if (projectId === "questoon") {
            return { repository: { localPath: "/Users/koba/projects/questoon" } };
          }
          if (projectId === "luno") {
            return { repository: { localPath: "/Users/koba/projects/luno" } };
          }
          return null;
        },
        agentFor(projectId) {
          if (projectId === "questoon") {
            return { agent: "claude" };
          }
          if (projectId === "luno") {
            return { agent: "codex" };
          }
          return null;
        },
      },
      runtime,
    );

    await scheduler.tick();

    expect(worktreeCalls).toEqual([
      { repository: "/Users/koba/projects/questoon", taskId: "TASK-102", projectId: "questoon" },
      { repository: "/Users/koba/projects/luno", taskId: "TASK-200", projectId: "luno" },
    ]);
    expect(executed).toEqual([
      "claude:/worktrees/questoon/TASK-102",
      "codex:/worktrees/luno/TASK-200",
    ]);
  });

  it("fails the task before creating a worktree when the agent is unauthenticated", async () => {
    const task = readyTask();
    task.projectId = "luno";
    const tasks = new MemoryTasks([task]);
    const runtime: AgentRuntime = {
      resolve(agentId) {
        return {
          agentId,
          command: "codex",
          args: [],
          workingDirectoryMode: "worktree",
          capabilities: {
            nonInteractive: true,
            filesystemWrite: true,
            shellExecution: true,
            worktree: true,
            structuredOutput: false,
            permissionPolicy: true,
          },
          async checkAvailability() {
            return "unauthenticated";
          },
          async execute() {
            throw new Error("should not execute");
          },
        };
      },
      defaultAgent() {
        return this.resolve("claude");
      },
    };
    const { scheduler, worktreeCalls } = createHarness(
      tasks,
      { async execute() { throw new Error("unused"); } },
      undefined,
      {
        project() {
          return { repository: { localPath: "/Users/koba/projects/luno" } };
        },
        agentFor() {
          return { agent: "codex" };
        },
      },
      runtime,
    );

    await scheduler.tick();

    expect(worktreeCalls).toEqual([]);
    expect(tasks.items[0]?.status).toBe("FAILED");
    expect(tasks.items[0]?.error).toContain("agent codex is unauthenticated");
  });
});
