import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildCommitMessage, findSecretPaths, GitService } from "../src/git/git.service.js";
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

async function git(cwd: string, args: string[]): Promise<string> {
  const result = await runCommand({ command: "git", args, cwd, env: gitEnv });
  if (result.exitCode !== 0) {
    throw new Error(result.stderr || result.stdout);
  }
  return result.stdout.trim();
}

describe("commit messages", () => {
  it("uses the task title and a type from the title or agent", () => {
    expect(buildCommitMessage({ taskId: "TASK-102", title: "顧客CSV出力を追加", agentType: "backend" })).toBe(
      "feat(TASK-102): 顧客CSV出力を追加",
    );
    expect(buildCommitMessage({ taskId: "TASK-9", title: "READMEに説明を追加", agentType: "backend" })).toBe(
      "docs(TASK-9): READMEに説明を追加",
    );
    expect(buildCommitMessage({ taskId: "TASK-3", title: "画面を直す", agentType: "test" })).toBe(
      "test(TASK-3): 画面を直す",
    );
  });

  it("recognizes secret paths", () => {
    expect(findSecretPaths(["README.md", ".env", "src/keys/id_rsa"])).toEqual([".env", "src/keys/id_rsa"]);
  });
});

describe("GitService", () => {
  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  it("commits repository changes and skips a clean tree", async () => {
    const scratch = path.join(process.cwd(), ".tmp");
    await mkdir(scratch, { recursive: true });
    const root = await mkdtemp(path.join(scratch, "git-"));
    roots.push(root);
    await git(root, ["init", "-b", "main"]);
    await writeFile(path.join(root, "README.md"), "before\n");
    await git(root, ["add", "README.md"]);
    await git(root, ["commit", "-m", "init"]);
    await writeFile(path.join(root, "README.md"), "after\n");

    const service = new GitService(runCommand, gitEnv);
    const committed = await service.commitIfNeeded(root, "feat(TASK-102): 顧客CSV出力を追加");
    expect(committed.committed).toBe(true);
    expect(committed.sha.length).toBeGreaterThan(0);
    expect(await git(root, ["log", "-1", "--format=%s"])).toBe("feat(TASK-102): 顧客CSV出力を追加");

    const clean = await service.commitIfNeeded(root, "feat(TASK-102): 顧客CSV出力を追加");
    expect(clean.committed).toBe(false);
  });

  it("does not commit a secret file", async () => {
    const scratch = path.join(process.cwd(), ".tmp");
    await mkdir(scratch, { recursive: true });
    const root = await mkdtemp(path.join(scratch, "git-"));
    roots.push(root);
    await git(root, ["init", "-b", "main"]);
    await git(root, ["commit", "--allow-empty", "-m", "init"]);
    await writeFile(path.join(root, ".env"), "TOKEN=secret\n");

    const service = new GitService(runCommand, gitEnv);
    await expect(service.commitIfNeeded(root, "feat(TASK-102): add secret")).rejects.toThrow(/secret files/);
    expect(await git(root, ["log", "-1", "--format=%s"])).toBe("init");
  });
});
