import type { AgentRuntime, ResolvedAgentRuntime } from "../agents/agent-runtime.js";
import { buildCodingPrompt } from "../agents/coding-prompt.js";
import { buildCommitMessage, type CommitResult, type GitService } from "../git/git.service.js";
import type { WorktreeService } from "../git/worktree.service.js";
import type { Task, TaskPatch, TaskStatus } from "../tasks/task.types.js";
import { sanitizeError } from "../utils/errors.js";
import type { AppLogger } from "../utils/logger.js";

export interface SchedulerTasks {
  listByStatus(status: TaskStatus): Promise<Task[]>;
  transition(notionPageId: string, from: TaskStatus, patch: TaskPatch): Promise<Task | null>;
}

export interface SchedulerOptions {
  enabled: boolean;
  intervalMs: number;
  worktreeRoot: string;
}

const RESULT_LIMIT = 8000;

export interface ProjectBinding {
  project(projectId: string): { repository: { localPath: string } } | null;
  agentFor?(projectId: string, role: "coding"): { agent: string } | null;
}

export class SchedulerService {
  private timer: ReturnType<typeof setInterval> | undefined;
  private ticking = false;
  private readonly inFlight = new Set<string>();

  constructor(
    private readonly tasks: SchedulerTasks,
    private readonly worktrees: Pick<WorktreeService, "create">,
    private readonly git: Pick<GitService, "commitIfNeeded">,
    private readonly runtime: AgentRuntime,
    private readonly logger: AppLogger,
    private readonly options: SchedulerOptions,
    private readonly projects?: ProjectBinding,
  ) {}

  start(): void {
    if (!this.options.enabled) {
      this.logger.info({ event: "scheduler.disabled", status: "READY" }, "scheduler disabled");
      return;
    }
    if (this.options.worktreeRoot.length === 0) {
      this.logger.error(
        {
          event: "scheduler.disabled",
          status: "FAILED",
          error: { name: "ConfigError", message: "WORKTREE_ROOT is empty" },
        },
        "scheduler requires WORKTREE_ROOT",
      );
      return;
    }
    if (this.timer) {
      return;
    }
    this.timer = setInterval(() => {
      void this.tick();
    }, this.options.intervalMs);
    void this.tick();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  async tick(): Promise<void> {
    if (this.ticking) {
      return;
    }
    this.ticking = true;
    try {
      const ready = await this.tasks.listByStatus("READY");
      if (ready.length === 0) {
        this.logger.debug({ event: "scheduler.idle", status: "READY" }, "no ready tasks");
        return;
      }
      for (const task of ready) {
        await this.runTask(task);
      }
    } catch (error) {
      this.logger.error(
        { event: "scheduler.tick_failed", status: "FAILED", error: sanitizeError(error) },
        "scheduler tick failed",
      );
    } finally {
      this.ticking = false;
    }
  }

  private async runTask(task: Task): Promise<void> {
    if (this.inFlight.has(task.taskId)) {
      return;
    }
    this.inFlight.add(task.taskId);
    let status: TaskStatus = "READY";
    try {
      const assigned = await this.tasks.transition(task.notionPageId, "READY", { status: "ASSIGNED" });
      if (!assigned) {
        return;
      }
      status = "ASSIGNED";
      this.logger.info(
        { taskId: task.taskId, agentType: task.agentType, event: "task.assigned", status },
        "task assigned",
      );

      const projectId = task.projectId ?? "";
      const execution = await this.resolveExecution(task, projectId);
      const availability = await execution.agent.checkAvailability();
      if (availability !== "available") {
        throw new Error(`agent ${execution.agent.agentId} is ${availability}`);
      }
      const created = await this.worktrees.create(execution.repository, task.taskId, projectId);
      const coding = await this.tasks.transition(task.notionPageId, "ASSIGNED", {
        status: "CODING",
        branch: created.branch,
        worktree: created.worktree,
      });
      if (!coding) {
        throw new Error("task left ASSIGNED before coding started");
      }
      status = "CODING";
      this.logger.info(
        { taskId: task.taskId, agentType: task.agentType, event: "task.coding", status },
        "task coding",
      );

      const result = await execution.agent.execute({
        taskId: task.taskId,
        worktree: created.worktree,
        prompt: buildCodingPrompt({
          taskId: task.taskId,
          title: task.title,
          description: task.description,
          agentType: task.agentType,
          repository: execution.repository,
          worktree: created.worktree,
        }),
      });
      if (!result.success || result.exitCode !== 0) {
        await this.fail(task, status, result.error || "coding agent failed");
        return;
      }

      const commit = await this.git.commitIfNeeded(created.worktree, buildCommitMessage(task));
      await this.tasks.transition(task.notionPageId, "CODING", {
        status: "DONE",
        result: formatDoneResult(result.output, commit),
        error: "",
      });
      this.logger.info(
        { taskId: task.taskId, agentType: task.agentType, event: "task.done", status: "DONE" },
        "task done",
      );
    } catch (error) {
      await this.fail(task, status, sanitizeError(error).message);
    } finally {
      this.inFlight.delete(task.taskId);
    }
  }

  private async resolveExecution(task: Task, projectId: string): Promise<{ repository: string; agent: ResolvedAgentRuntime }> {
    if (projectId.length === 0) {
      return { repository: task.repository, agent: this.runtime.defaultAgent() };
    }
    const link = this.projects?.agentFor?.(projectId, "coding");
    if (this.projects?.agentFor && !link) {
      throw new Error(`no coding agent linked: ${projectId}`);
    }
    const project = this.projects?.project(projectId) ?? null;
    if (!project) {
      throw new Error(`unknown project: ${projectId}`);
    }
    const agent = link ? this.runtime.resolve(link.agent) : this.runtime.defaultAgent();
    return { repository: project.repository.localPath, agent };
  }

  private async fail(task: Task, from: TaskStatus, message: string): Promise<void> {
    const error = message.slice(0, 4000);
    try {
      const updated = await this.tasks.transition(task.notionPageId, from, { status: "FAILED", error });
      this.logger.error(
        {
          taskId: task.taskId,
          agentType: task.agentType,
          event: updated ? "task.failed" : "task.fail_unapplied",
          status: "FAILED",
          error: { name: "Error", message: error },
        },
        "task failed",
      );
    } catch (updateError) {
      this.logger.error(
        {
          taskId: task.taskId,
          agentType: task.agentType,
          event: "task.fail_unapplied",
          status: "FAILED",
          error: sanitizeError(updateError),
        },
        "failed to mark task FAILED",
      );
    }
  }
}

function formatDoneResult(output: string, commit: CommitResult): string {
  const head = commit.committed
    ? `commit ${commit.sha}\n${commit.subject}${commit.diffStat ? `\n${commit.diffStat}` : ""}`
    : "変更はないため commit していません";
  return `${head}\n\n${output}`.slice(0, RESULT_LIMIT);
}
