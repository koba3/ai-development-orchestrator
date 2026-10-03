import { describe, expect, it } from "vitest";
import { buildCodingPrompt } from "../src/agents/claude-code.prompt.js";
import { ClaudeCodeRunner, claudeArguments, splitCommandArgs } from "../src/agents/claude-code.runner.js";
import type { CommandRequest } from "../src/utils/command.js";

describe("ClaudeCodeRunner", () => {
  it("runs claude in the worktree with the non-interactive flags from claude --help", async () => {
    const calls: CommandRequest[] = [];
    const runner = new ClaudeCodeRunner(
      { command: "claude", extraArgs: splitCommandArgs('--model sonnet'), timeoutMs: 5000 },
      async (request) => {
        calls.push(request);
        return { exitCode: 0, stdout: "implemented\n", stderr: "" };
      },
      { ANTHROPIC_API_KEY: "sk-abcdefghijklmnopqrstuvwxyz", PATH: "/usr/bin" },
    );

    const result = await runner.execute({
      taskId: "TASK-102",
      prompt: "implement the task",
      worktree: "/worktrees/TASK-102",
    });

    expect(result).toMatchObject({ success: true, output: "implemented", error: "", exitCode: 0 });
    expect(calls[0]?.command).toBe("claude");
    expect(calls[0]?.cwd).toBe("/worktrees/TASK-102");
    expect(calls[0]?.input).toBe("implement the task");
    expect(calls[0]?.args).toEqual(claudeArguments(["--model", "sonnet"]));
    expect(calls[0]?.args).toContain("-p");
    expect(calls[0]?.args).toContain("acceptEdits");
    expect(calls[0]?.args).not.toContain("bypassPermissions");
    expect(calls[0]?.env?.ANTHROPIC_API_KEY).toBeUndefined();
    expect(calls[0]?.env?.PATH).toBe("/usr/bin");
  });

  it("returns a failed result when claude exits non-zero", async () => {
    const runner = new ClaudeCodeRunner(
      { command: "claude", extraArgs: [], timeoutMs: 1000 },
      async () => ({ exitCode: 1, stdout: "", stderr: "boom" }),
    );
    const result = await runner.execute({ taskId: "TASK-1", prompt: "x", worktree: "/tmp/wt" });
    expect(result.success).toBe(false);
    expect(result.exitCode).toBe(1);
    expect(result.error).toBe("boom");
  });
});

describe("buildCodingPrompt", () => {
  it("includes the task and forbids push, commit, deploy, and secrets", () => {
    const prompt = buildCodingPrompt({
      taskId: "TASK-102",
      title: "顧客CSV出力を追加",
      description: "管理者のみ利用可能。",
      agentType: "backend",
      repository: "/tmp/questoon",
      worktree: "/worktrees/TASK-102",
    });
    expect(prompt).toContain("TASK-102");
    expect(prompt).toContain("管理者のみ利用可能。");
    expect(prompt).toContain("/worktrees/TASK-102");
    expect(prompt).toContain("git pushはしない");
    expect(prompt).toContain("commitしない");
    expect(prompt).toContain("本番環境へdeployしない");
    expect(prompt).toContain("secretsを作成・変更・出力しない");
  });
});
