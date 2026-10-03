import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { UnknownAgentError, UnsupportedAgentError } from "../src/agents/agent-errors.js";
import { createAgentRuntime } from "../src/agents/agent-runtime.js";
import { ClaudeCodeRunner } from "../src/agents/claude-code.runner.js";
import { parseProjectCatalog } from "../src/routing/project-catalog.js";

const runtime = createAgentRuntime({
  codingAgent: "claude",
  claudeCommand: "claude",
  claudeExtraArgs: "",
  claudeTimeoutMs: 1000,
});

describe("AgentRuntime", () => {
  it("resolves claude to the Claude Code runner", () => {
    expect(runtime.resolve("claude")).toBeInstanceOf(ClaudeCodeRunner);
    expect(runtime.defaultAgent()).toBe(runtime.resolve("claude"));
  });

  it("rejects codex and cursor until a runner exists", () => {
    expect(() => runtime.resolve("codex")).toThrow(UnsupportedAgentError);
    expect(() => runtime.resolve("codex")).toThrow("unsupported agent: codex");
    expect(() => runtime.resolve("cursor")).toThrow(UnsupportedAgentError);
    expect(() => runtime.resolve("cursor")).toThrow("unsupported agent: cursor");
  });

  it("rejects an agent id that is not defined", () => {
    expect(() => runtime.resolve("gpt")).toThrow(UnknownAgentError);
    expect(() => runtime.resolve("gpt")).toThrow("unknown agent: gpt");
  });

  it("accepts a codex link in the project catalog", () => {
    const catalog = parseProjectCatalog({
      projects: {
        questoon: {
          name: "Questoon",
          repository: { mode: "local", localPath: "/tmp/questoon", remoteRepository: "koba3/questoon" },
        },
        luno: {
          name: "LUNO",
          repository: { mode: "local", localPath: "/tmp/luno", remoteRepository: "koba3/luno" },
        },
      },
      agentLinks: [
        { projectId: "questoon", role: "coding", agent: "claude" },
        { projectId: "luno", role: "coding", agent: "codex" },
      ],
    });
    expect(catalog.agentLinks?.map((link) => link.agent)).toEqual(["claude", "codex"]);
  });

  it("rejects an agent id outside claude, codex, and cursor", () => {
    expect(() =>
      parseProjectCatalog({
        projects: {
          luno: {
            name: "LUNO",
            repository: { mode: "local", localPath: "/tmp/luno", remoteRepository: "" },
          },
        },
        agentLinks: [{ projectId: "luno", role: "coding", agent: "gpt" }],
      }),
    ).toThrow(/gpt/);
  });
});

describe("Scheduler agent boundary", () => {
  it("does not choose a coding agent implementation", () => {
    const source = readFileSync(new URL("../src/scheduler/scheduler.service.ts", import.meta.url), "utf8");
    expect(source).not.toContain("ClaudeCodeRunner");
    expect(source).not.toContain('agent === "claude"');
    expect(source).not.toContain('agent === "codex"');
    expect(source).not.toContain('agent === "cursor"');
  });
});
