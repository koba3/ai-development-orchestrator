import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig } from "../src/config/index.js";

const validEnv = {
  SLACK_BOT_TOKEN: "xoxb-test",
  SLACK_APP_TOKEN: "xapp-test",
  SLACK_SIGNING_SECRET: "sign",
  NOTION_TOKEN: "ntn_test",
  NOTION_TASK_DATABASE_ID: "db",
  LLM_PROVIDER: "openai",
  OPENAI_API_KEY: "sk-test",
};

describe("loadConfig", () => {
  it("reads the phase 1 settings", () => {
    const config = loadConfig({
      ...validEnv,
      SLACK_CHANNEL_IDS: "C1, C2",
      DEFAULT_REPOSITORY: "/tmp/questoon",
      PLAN_CONFIDENCE_THRESHOLD: "0.4",
    });
    expect(config.slackChannelIds).toEqual(["C1", "C2"]);
    expect(config.defaultRepository).toBe("/tmp/questoon");
    expect(config.planConfidenceThreshold).toBe(0.4);
    expect(config.llmProvider).toBe("openai");
    expect(config.codingAgent).toBe("claude");
    expect(config.schedulerIntervalMs).toBe(5000);
    expect(config.schedulerEnabled).toBe(true);
  });

  it("disables the host scheduler without dropping the worktree root", () => {
    const config = loadConfig({
      ...validEnv,
      SCHEDULER_ENABLED: "false",
      WORKTREE_ROOT: "/tmp/worktrees",
      CLAUDE_COMMAND: "claude",
    });
    expect(config.schedulerEnabled).toBe(false);
    expect(config.worktreeRoot).toBe("/tmp/worktrees");
    expect(config.claudeCommand).toBe("claude");
  });

  it("reports missing variable names without values", () => {
    expect(() => loadConfig({ LLM_PROVIDER: "openai", OPENAI_API_KEY: "sk-secret-value" })).toThrow(ConfigError);
    try {
      loadConfig({ LLM_PROVIDER: "openai", OPENAI_API_KEY: "sk-secret-value" });
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      expect((error as Error).message).toContain("SLACK_BOT_TOKEN");
      expect((error as Error).message).not.toContain("sk-secret-value");
    }

    expect(() =>
      loadConfig({
        ...validEnv,
        LLM_PROVIDER: "anthropic",
        OPENAI_API_KEY: "sk-secret-value",
        ANTHROPIC_API_KEY: "",
      }),
    ).toThrow(/ANTHROPIC_API_KEY/);
  });
});
