import type { NewTask, Task, TaskPatch, TaskStatus } from "./task.types.js";

export interface TaskStore {
  findBySourceMessage(sourceMessageTs: string, slackChannel: string): Promise<Task[]>;
  findByStatus(status: TaskStatus): Promise<Task[]>;
  insert(task: NewTask): Promise<Task>;
  transition(notionPageId: string, from: TaskStatus, patch: TaskPatch): Promise<Task | null>;
}
