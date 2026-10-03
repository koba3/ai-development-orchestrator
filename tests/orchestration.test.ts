import { describe, expect, it } from "vitest";
import { Orchestration } from "../src/orchestration/orchestration.js";
import { ProjectRouter } from "../src/routing/project-router.js";
import type { ProjectCatalogFile } from "../src/routing/project.types.js";
import { toOrchestrationInput } from "../src/slack/slack-input.adapter.js";

const catalog: ProjectCatalogFile = {
  inputs: [
    {
      id: "slack-bespoke",
      type: "slack",
      name: "ビスポーク",
      enabled: true,
      connection: { workspaceId: "T-A" },
    },
    {
      id: "slack-other",
      type: "slack",
      name: "停止中",
      enabled: false,
      connection: { workspaceId: "T-OFF" },
    },
  ],
  workspaces: {
    bespoke: {
      id: "T-A",
      name: "ビスポーク",
      channels: {
        development: {
          id: "C-DEV",
          name: "development",
          hashtags: {
            questoon: { projectId: "questoon" },
            luno: { projectId: "luno" },
          },
        },
      },
    },
    other: {
      id: "T-OFF",
      name: "停止中",
      channels: {
        development: {
          id: "C-OFF",
          name: "development",
          hashtags: { questoon: { projectId: "questoon" } },
        },
      },
    },
  },
  projects: {
    questoon: {
      name: "Questoon",
      repository: { mode: "local", localPath: "/Users/koba/projects/questoon", remoteRepository: "koba3/questoon" },
    },
    luno: {
      name: "LUNO",
      repository: { mode: "local", localPath: "/Users/koba/projects/luno", remoteRepository: "koba3/luno" },
    },
  },
  agentLinks: [
    { projectId: "questoon", role: "coding", agent: "claude" },
    { projectId: "questoon", role: "test", agent: "claude" },
    { projectId: "luno", role: "coding", agent: "claude" },
  ],
};

function slackInput(workspaceId: string, channelId: string, text: string) {
  return toOrchestrationInput({
    workspaceId,
    channel: channelId,
    user: "U1",
    text,
    messageTs: "1",
    threadTs: "1",
  });
}

describe("Orchestration", () => {
  const orchestration = new Orchestration(catalog, new ProjectRouter(catalog));

  it("connects a Slack input to a project and its agents", () => {
    const connected = orchestration.connect(slackInput("T-A", "C-DEV", "#questoon ログインを追加"));
    expect(connected.ok).toBe(true);
    if (!connected.ok) {
      return;
    }
    expect(connected.input.id).toBe("slack-bespoke");
    expect(connected.project).toEqual({
      projectId: "questoon",
      name: "Questoon",
      repository: catalog.projects.questoon?.repository,
    });
    expect(connected.agents.map((link) => link.role).sort()).toEqual(["coding", "test"]);
    expect(connected.route.localPath).toBe("/Users/koba/projects/questoon");
  });

  it("does not connect a disabled input", () => {
    const connected = orchestration.connect(slackInput("T-OFF", "C-OFF", "#questoon"));
    expect(connected.ok).toBe(false);
    if (!connected.ok) {
      expect(connected.reason).toBe("input-unavailable");
    }
  });

  it("derives a Slack input and a coding agent when the catalog omits them", () => {
    const derived = new Orchestration(
      {
        workspaces: catalog.workspaces,
        projects: { questoon: catalog.projects.questoon! },
      },
      new ProjectRouter({
        workspaces: catalog.workspaces,
        projects: { questoon: catalog.projects.questoon! },
      }),
    );
    const connected = derived.connect(slackInput("T-A", "C-DEV", "#questoon"));
    expect(connected.ok && connected.input.connection.workspaceId).toBe("T-A");
    expect(derived.agentFor("questoon", "coding")?.agent).toBe("claude");
    expect(derived.agentFor("questoon", "review")).toBeNull();
  });
});
