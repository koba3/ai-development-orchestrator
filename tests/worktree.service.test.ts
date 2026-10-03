import { mkdir, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { WorktreeService } from "../src/git/worktree.service.js";
import { runCommand } from "../src/utils/command.js";

const roots: string[] = [];

const gitEnv = {
  ...process.env,
  GIT_AUTHOR_NAME: "Test",
  GIT_AUTHOR_EMAIL: "test@example.com",
  GIT_COMMITTER_NAME: "Test",
  GIT_COMMITTER_EMAIL: "test@example.com",
  GIT_TERMINAL_PROMPT: "0",
};

async function git(cwd: string, args: string[]): Promise<void> {
  const result = await runCommand({ command: "git", args, cwd, env: gitEnv });
  if (result.exitCode !== 0) {
    throw new Error(result.stderr || result.stdout);
  }
}

describe("WorktreeService", () => {
  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  it("creates a feature branch worktree outside the repository", async () => {
    const scratch = path.join(process.cwd(), ".tmp");
    await mkdir(scratch, { recursive: true });
    const root = await mkdtemp(path.join(scratch, "worktree-"));
    roots.push(root);
    const repository = path.join(root, "questoon");
    await git(root, ["init", "-b", "main", repository]);
    await git(repository, ["commit", "--allow-empty", "-m", "init"]);

    const created = await new WorktreeService(path.join(root, "worktrees")).create(repository, "TASK-102");

    expect(created.branch).toBe("feature/TASK-102");
    expect(created.worktree).toBe(path.join(root, "worktrees", "TASK-102"));
    const branch = await runCommand({
      command: "git",
      args: ["-C", created.worktree, "rev-parse", "--abbrev-ref", "HEAD"],
      cwd: created.worktree,
      env: gitEnv,
    });
    const mainBranch = await runCommand({
      command: "git",
      args: ["-C", repository, "rev-parse", "--abbrev-ref", "HEAD"],
      cwd: repository,
      env: gitEnv,
    });
    expect(branch.stdout.trim()).toBe("feature/TASK-102");
    expect(mainBranch.stdout.trim()).toBe("main");
  });

  it("separates worktrees by project id", async () => {
    const scratch = path.join(process.cwd(), ".tmp");
    await mkdir(scratch, { recursive: true });
    const root = await mkdtemp(path.join(scratch, "worktree-"));
    roots.push(root);
    const repository = path.join(root, "questoon");
    await git(root, ["init", "-b", "main", repository]);
    await git(repository, ["commit", "--allow-empty", "-m", "init"]);

    const created = await new WorktreeService(path.join(root, "worktrees")).create(repository, "TASK-102", "questoon");

    expect(created.worktree).toBe(path.join(root, "worktrees", "questoon", "TASK-102"));
    expect(created.branch).toBe("feature/TASK-102");
  });

  it("fails when the repository does not exist", async () => {
    const scratch = path.join(process.cwd(), ".tmp");
    await mkdir(scratch, { recursive: true });
    const root = await mkdtemp(path.join(scratch, "worktree-"));
    roots.push(root);
    await expect(new WorktreeService(path.join(root, "worktrees")).create(path.join(root, "missing"), "TASK-102")).rejects.toThrow(
      "repository does not exist",
    );
  });
});
