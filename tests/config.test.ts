import { describe, expect, it } from "vitest";
import { createAgentRuntime } from "../src/agents/agent-runtime.js";
import { ConfigError, loadConfig } from "../src/config/index.js";

const localEnv = {
  NOTION_TOKEN: "ntn_test",
  NOTION_TASK_DATABASE_ID: "db",
  ENCRYPTION_KEY: "test-encryption-key",
  ADMIN_TOKEN: "test-admin-token-value",
  CODING_AGENT: "claude",
  CLAUDE_COMMAND: "claude",
};

describe("loadConfig", () => {
  it("reads the phase 1 settings", () => {
    const config = loadConfig({
      ...localEnv,
      PLANNER_PROVIDER: "openai",
      OPENAI_API_KEY: "sk-test",
      DEFAULT_REPOSITORY: "/tmp/questoon",
      PLAN_CONFIDENCE_THRESHOLD: "0.4",
    });
    expect(config.slackConnectionsConfig).toBe("config/slack-connections.json");
    expect(config.defaultRepository).toBe("/tmp/questoon");
    expect(config.planConfidenceThreshold).toBe(0.4);
    expect(config.plannerProvider).toBe("openai");
    expect(config.codingAgent).toBe("claude");
    expect(config.schedulerIntervalMs).toBe(5000);
    expect(config.schedulerEnabled).toBe(true);
  });

  it("accepts a local coding agent without OpenAI or Anthropic API keys", async () => {
    const config = loadConfig(localEnv);
    expect(config.plannerProvider).toBeNull();
    expect(config.openaiApiKey).toBe("");
    expect(config.anthropicApiKey).toBe("");
    expect(config.codingAgent).toBe("claude");
    expect(config.claudeCommand).toBe("claude");
    expect(config.claudeTimeoutMs).toBe(1_800_000);
    const runtime = createAgentRuntime({
      codingAgent: config.codingAgent,
      timeoutMs: config.claudeTimeoutMs,
    }, {
      probes: { async commandExists() { return false; }, async commandStatus() { return "missing"; } },
    });
    expect(runtime.resolve("claude").agentId).toBe("claude");
    expect(runtime.resolve("codex").agentId).toBe("codex");
    expect(runtime.resolve("cursor").agentId).toBe("cursor");
    await expect(runtime.resolve("codex").checkAvailability()).resolves.toBe("unavailable");
  });

  it("requires OPENAI_API_KEY only when the planner uses OpenAI", () => {
    expect(() => loadConfig({ ...localEnv, PLANNER_PROVIDER: "openai" })).toThrow(
      /OPENAI_API_KEY is required when PLANNER_PROVIDER=openai/,
    );
  });

  it("requires ANTHROPIC_API_KEY only when the planner uses Anthropic", () => {
    expect(() => loadConfig({ ...localEnv, PLANNER_PROVIDER: "anthropic", ANTHROPIC_API_KEY: "" })).toThrow(
      /ANTHROPIC_API_KEY is required when PLANNER_PROVIDER=anthropic/,
    );
  });

  it("disables the host scheduler without dropping the worktree root", () => {
    const config = loadConfig({
      ...localEnv,
      SCHEDULER_ENABLED: "false",
      WORKTREE_ROOT: "/tmp/worktrees",
      CLAUDE_COMMAND: "claude",
    });
    expect(config.schedulerEnabled).toBe(false);
    expect(config.worktreeRoot).toBe("/tmp/worktrees");
    expect(config.claudeCommand).toBe("claude");
  });

  it("reports missing variable names without values or a planner API key", () => {
    expect(() => loadConfig({})).toThrow(ConfigError);
    try {
      loadConfig({});
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      const message = (error as Error).message;
      expect(message).toContain("Missing required environment variables:");
      expect(message).toContain("- NOTION_TOKEN");
      expect(message).toContain("- NOTION_TASK_DATABASE_ID");
      expect(message).toContain("- ENCRYPTION_KEY");
      expect(message).toContain("- ADMIN_TOKEN");
      expect(message).not.toContain("SLACK_BOT_TOKEN");
      expect(message).not.toContain("LLM_PROVIDER");
      expect(message).not.toContain("OPENAI_API_KEY");
      expect(message).not.toContain("ANTHROPIC_API_KEY");
    }
  });
});
