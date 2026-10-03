import { mkdir, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { runCommand, type CommandRequest, type CommandResult } from "../utils/command.js";

const TASK_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/;

export interface WorktreeCreateResult {
  worktree: string;
  branch: string;
}

export type CommandRunner = (request: CommandRequest) => Promise<CommandResult>;

export class WorktreeService {
  constructor(
    private readonly worktreeRoot: string,
    private readonly run: CommandRunner = runCommand,
  ) {}

  async create(repository: string, taskId: string, projectId = ""): Promise<WorktreeCreateResult> {
    if (!TASK_ID_PATTERN.test(taskId)) {
      throw new Error("invalid task id");
    }
    if (projectId.length > 0 && !TASK_ID_PATTERN.test(projectId)) {
      throw new Error("invalid project id");
    }
    if (repository.trim().length === 0) {
      throw new Error("repository path is empty");
    }
    const root = path.resolve(this.worktreeRoot);
    const destination = projectId.length > 0 ? path.resolve(root, projectId, taskId) : path.resolve(root, taskId);
    const relative = path.relative(root, destination);
    if (relative.length === 0 || relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error("invalid task id");
    }

    let repositoryPath: string;
    try {
      const info = await stat(repository);
      if (!info.isDirectory()) {
        throw new Error("repository path is not a directory");
      }
      repositoryPath = await realpath(repository);
    } catch (error) {
      if (error instanceof Error && error.message === "repository path is not a directory") {
        throw error;
      }
      throw new Error("repository does not exist");
    }

    if (destination === repositoryPath || destination.startsWith(`${repositoryPath}${path.sep}`)) {
      throw new Error("worktree path must be outside the repository");
    }

    const inside = await this.run({
      command: "git",
      args: ["-C", repositoryPath, "rev-parse", "--is-inside-work-tree"],
      cwd: repositoryPath,
      env: gitEnvironment(),
    });
    if (inside.exitCode !== 0 || inside.stdout.trim() !== "true") {
      throw new Error("path is not a git repository");
    }

    await mkdir(path.dirname(destination), { recursive: true });
    const branch = `feature/${taskId}`;
    const created = await this.run({
      command: "git",
      args: ["-C", repositoryPath, "worktree", "add", "-b", branch, destination],
      cwd: repositoryPath,
      env: gitEnvironment(),
    });
    if (created.exitCode !== 0) {
      const detail = created.stderr.trim() || created.stdout.trim() || "git worktree add failed";
      throw new Error(detail);
    }
    return { worktree: destination, branch };
  }
}

function gitEnvironment(): NodeJS.ProcessEnv {
  return { ...process.env, GIT_TERMINAL_PROMPT: "0" };
}
