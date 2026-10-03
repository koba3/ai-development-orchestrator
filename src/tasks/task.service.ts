import type { AppLogger } from "../utils/logger.js";
import { sanitizeError } from "../utils/errors.js";
import { createPrefixedId } from "../utils/ids.js";
import type { DevelopmentPlan } from "../orchestrator/planner.prompt.js";
import type { TaskStore } from "./task.store.js";
import type { NewTask, Task, TaskStatus } from "./task.types.js";

export interface CreateTasksInput {
  plan: DevelopmentPlan;
  status: Extract<TaskStatus, "READY" | "NEEDS_HUMAN">;
  humanQuestion: string;
  slackChannel: string;
  slackThreadTs: string;
  sourceMessageTs: string;
}

export interface TaskServiceOptions {
  defaultRepository: string;
  now?: () => Date;
  createTaskId?: () => string;
  createRequestId?: () => string;
}

export function resolveRepository(suggested: string | null, fallback: string): string {
  const value = suggested?.trim() ?? "";
  if (value.includes("/") || value.includes("\\")) {
    return value;
  }
  if (fallback.length > 0) {
    return fallback;
  }
  return value;
}

export class TaskService {
  constructor(
    private readonly store: TaskStore,
    private readonly logger: AppLogger,
    private readonly options: TaskServiceOptions,
  ) {}

  findBySourceMessage(sourceMessageTs: string, slackChannel: string): Promise<Task[]> {
    return this.store.findBySourceMessage(sourceMessageTs, slackChannel);
  }

  async create(input: CreateTasksInput): Promise<Task[]> {
    const requestId = (this.options.createRequestId ?? (() => createPrefixedId("REQ")))();
    const now = (this.options.now ?? (() => new Date()))().toISOString();
    const createTaskId = this.options.createTaskId ?? (() => createPrefixedId("TASK"));
    const tasks: Task[] = [];

    for (const planned of input.plan.tasks) {
      const draft: NewTask = {
        taskId: createTaskId(),
        title: planned.title,
        description: planned.description,
        status: input.status,
        priority: planned.priority,
        agentType: planned.agentType,
        repository: resolveRepository(planned.repository, this.options.defaultRepository),
        branch: "",
        worktree: "",
        pullRequestUrl: "",
        result: "",
        error: "",
        createdAt: now,
        updatedAt: now,
        retryCount: 0,
        requestId,
        summary: input.plan.summary,
        slackChannel: input.slackChannel,
        slackThreadTs: input.slackThreadTs,
        sourceMessageTs: input.sourceMessageTs,
        humanQuestion: input.humanQuestion,
        confidence: input.plan.confidence,
      };
      try {
        const created = await this.store.insert(draft);
        this.logger.info(
          {
            taskId: created.taskId,
            agentType: created.agentType,
            event: "task.created",
            status: created.status,
          },
          "task created",
        );
        tasks.push(created);
      } catch (error) {
        this.logger.error(
          {
            taskId: draft.taskId,
            agentType: draft.agentType,
            event: "task.create_failed",
            status: "FAILED",
            error: sanitizeError(error),
          },
          "task create failed",
        );
        throw error;
      }
    }

    return tasks;
  }
}
