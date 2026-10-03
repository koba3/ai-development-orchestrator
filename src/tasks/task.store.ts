import type { NewTask, Task } from "./task.types.js";

export interface TaskStore {
  findBySourceMessage(sourceMessageTs: string, slackChannel: string): Promise<Task[]>;
  insert(task: NewTask): Promise<Task>;
}
