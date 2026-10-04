import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { applyCommandOverrides, loadAgentConfig } from "../src/agents/agent-config.js";
import { UnknownAgentError, UnsupportedAgentError } from "../src/agents/agent-errors.js";
import { createAgentRuntime } from "../src/agents/agent-runtime.js";
import type { AgentProbes } from "../src/agents/agent-probes.js";
import { ClaudeCodeRunner } from "../src/agents/claude-code.runner.js";
import { CodexRunner, codexArguments } from "../src/agents/codex-runner.js";
import { CursorRunner, cursorArguments } from "../src/agents/cursor-runner.js";
import type { CommandRequest } from "../src/utils/command.js";

const runtimeConfig = {
  codingAgent: "claude" as const,
  timeoutMs: 1000,
};

function probes(input: {
  exists?: (command: string) => boolean;
  status?: (command: string, args: string[]) => "missing" | "ok" | "failed";
}): AgentProbes {
  return {
    async commandExists(command) {
      return input.exists?.(command) ?? false;
    },
    async commandStatus(command, args) {
      return input.status?.(command, args) ?? "failed";
    },
  };
}

describe("AgentRuntime", () => {
  it("resolves each agent id to its runner without exposing the CLI", () => {
    const runtime = createAgentRuntime(runtimeConfig, { probes: probes({}) });
    const claude = runtime.resolve("claude");
    const codex = runtime.resolve("codex");
    const cursor = runtime.resolve("cursor");
    expect(claude).toBeInstanceOf(ClaudeCodeRunner);
    expect(codex).toBeInstanceOf(CodexRunner);
    expect(cursor).toBeInstanceOf(CursorRunner);
    expect(claude.agentId).toBe("claude");
    expect(codex.agentId).toBe("codex");
    expect(cursor.agentId).toBe("cursor");
    expect(codex.capabilities.worktree).toBe(true);
    expect(runtime.defaultAgent()).toBeInstanceOf(ClaudeCodeRunner);
  });

  it("reports unavailable when the CLI is not installed", async () => {
    const runtime = createAgentRuntime(runtimeConfig, { probes: probes({ exists: () => false }) });
    await expect(runtime.resolve("codex").checkAvailability()).resolves.toBe("unavailable");
    await expect(runtime.resolve("cursor").checkAvailability()).resolves.toBe("unavailable");
    await expect(runtime.resolve("claude").checkAvailability()).resolves.toBe("unavailable");
  });

  it("reports unauthenticated when the status command fails", async () => {
    const runtime = createAgentRuntime(runtimeConfig, {
      probes: probes({ exists: () => true, status: () => "failed" }),
    });
    await expect(runtime.resolve("codex").checkAvailability()).resolves.toBe("unauthenticated");
    await expect(runtime.resolve("cursor").checkAvailability()).resolves.toBe("unauthenticated");
    await expect(runtime.resolve("claude").checkAvailability()).resolves.toBe("available");
  });

  it("reports available when the CLI and its auth check succeed", async () => {
    const runtime = createAgentRuntime(runtimeConfig, {
      probes: probes({
        exists: () => true,
        status: (command, args) => (command === "codex" && args[0] === "login" ? "ok" : "ok"),
      }),
    });
    await expect(runtime.resolve("codex").checkAvailability()).resolves.toBe("available");
    await expect(runtime.resolve("cursor").checkAvailability()).resolves.toBe("available");
  });

  it("rejects an unknown agent before availability", () => {
    const runtime = createAgentRuntime(runtimeConfig, { probes: probes({}) });
    expect(() => runtime.resolve("gpt")).toThrow(UnknownAgentError);
    expect(() => runtime.resolve("gpt")).toThrow("unknown agent: gpt");
  });

  it("rejects a defined agent whose runtime is not registered", () => {
    const runtime = createAgentRuntime(runtimeConfig, { implemented: ["claude"], probes: probes({}) });
    expect(() => runtime.resolve("codex")).toThrow(UnsupportedAgentError);
    expect(() => runtime.resolve("codex")).toThrow("unsupported agent: codex");
  });

  it("runs codex exec in the worktree and cursor print mode without force", async () => {
    const calls: CommandRequest[] = [];
    const run = async (request: CommandRequest) => {
      calls.push(request);
      return { exitCode: 0, stdout: "done", stderr: "" };
    };
    await new CodexRunner({ command: "codex", extraArgs: [], timeoutMs: 1000 }, run, {
      OPENAI_API_KEY: "planner-key",
      CURSOR_API_KEY: "cursor-key",
      PATH: "/usr/bin",
    }).execute({
      taskId: "TASK-1",
      prompt: "implement",
      worktree: "/worktrees/luno/TASK-1",
    });
    await new CursorRunner({ command: "agent", extraArgs: [], timeoutMs: 1000 }, run).execute({
      taskId: "TASK-1",
      prompt: "implement",
      worktree: "/worktrees/luno/TASK-1",
    });
    expect(calls[0]?.args).toEqual(codexArguments("/worktrees/luno/TASK-1", []));
    expect(calls[0]?.input).toBe("implement");
    expect(calls[0]?.cwd).toBe("/worktrees/luno/TASK-1");
    expect(calls[0]?.env?.OPENAI_API_KEY).toBeUndefined();
    expect(calls[0]?.env?.CURSOR_API_KEY).toBe("cursor-key");
    expect(calls[0]?.args).not.toContain("--yolo");
    expect(calls[1]?.args).toEqual(cursorArguments("/worktrees/luno/TASK-1", "implement", []));
    expect(calls[1]?.args).not.toContain("--force");
    expect(calls[1]?.cwd).toBe("/worktrees/luno/TASK-1");
  });
});

describe("agent config", () => {
  it("uses built-in commands when the file is missing and lets env overrides replace them", () => {
    const missing = loadAgentConfig(join(tmpdir(), "missing-agents.json"));
    expect(missing.missing).toBe(true);
    const commands = applyCommandOverrides(missing.commands, { cursor: "cursor-agent" });
    expect(commands.claude.command).toBe("claude");
    expect(commands.codex.command).toBe("codex");
    expect(commands.cursor.command).toBe("cursor-agent");
  });

  it("reads commands from agents.json", () => {
    const directory = mkdtempSync(join(tmpdir(), "agents-"));
    const file = join(directory, "agents.json");
    writeFileSync(
      file,
      JSON.stringify({
        agents: {
          claude: { kind: "coding", command: "/opt/claude" },
          codex: { kind: "coding", command: "/opt/codex", extraArgs: "--model gpt-5" },
          cursor: { kind: "coding", command: "/opt/agent", timeoutMs: 5000 },
        },
      }),
    );
    const loaded = loadAgentConfig(file);
    expect(loaded.missing).toBe(false);
    expect(loaded.commands.claude.command).toBe("/opt/claude");
    expect(loaded.commands.codex.extraArgs).toEqual(["--model", "gpt-5"]);
    expect(loaded.commands.cursor.timeoutMs).toBe(5000);
  });
});

describe("architecture boundaries", () => {
  it("keeps orchestration from executing an agent", () => {
    const source = readFileSync(new URL("../src/orchestration/orchestration.ts", import.meta.url), "utf8");
    expect(source).not.toContain("ClaudeCodeRunner");
    expect(source).not.toContain("CodexRunner");
    expect(source).not.toContain("CursorRunner");
    expect(source).not.toContain(".execute(");
  });

  it("keeps agent-specific launch details in the registry", () => {
    const runtime = readFileSync(new URL("../src/agents/agent-runtime.ts", import.meta.url), "utf8");
    const registry = readFileSync(new URL("../src/agents/agent-registry.ts", import.meta.url), "utf8");
    expect(runtime).not.toContain("ClaudeCodeRunner");
    expect(runtime).not.toContain("CodexRunner");
    expect(runtime).not.toContain("CursorRunner");
    expect(runtime).not.toContain('=== "claude"');
    expect(runtime).not.toContain('=== "codex"');
    expect(runtime).not.toContain('=== "cursor"');
    expect(registry).toContain("ClaudeCodeRunner");
    expect(registry).toContain("CodexRunner");
    expect(registry).toContain("CursorRunner");
  });

  it("keeps the scheduler from choosing an agent implementation", () => {
    const source = readFileSync(new URL("../src/scheduler/scheduler.service.ts", import.meta.url), "utf8");
    expect(source).not.toContain("ClaudeCodeRunner");
    expect(source).not.toContain("CodexRunner");
    expect(source).not.toContain("CursorRunner");
    expect(source).not.toContain('agent === "claude"');
    expect(source).not.toContain('agent === "codex"');
    expect(source).not.toContain('agent === "cursor"');
    expect(source).not.toContain("SlackService");
    expect(source).not.toContain("slackBotToken");
  });
});
