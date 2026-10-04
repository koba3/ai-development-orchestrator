import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import pino from "pino";
import { ConfigError } from "../src/config/index.js";
import { NotificationService } from "../src/notifications/notification.service.js";
import { SlackConnectionManager } from "../src/slack/slack-connection-manager.js";
import { loadSlackConnections, type ResolvedSlackConnection } from "../src/slack/slack-connections.js";
import { SlackListener, type SlackMessageArgs, type SlackSocketApp } from "../src/slack/slack.listener.js";
import type { OrchestrationInput } from "../src/orchestration/orchestration.types.js";

const logger = pino({ level: "silent" });

function writeConnections(body: unknown): string {
  const directory = mkdtempSync(join(tmpdir(), "slack-"));
  const file = join(directory, "slack-connections.json");
  writeFileSync(file, JSON.stringify(body));
  return file;
}

const twoWorkspaces = {
  connections: [
    {
      id: "workspace-a",
      workspaceId: "T-A",
      channelIds: ["C-A"],
      botTokenEnv: "A_BOT",
      appTokenEnv: "A_APP",
      signingSecretEnv: "A_SECRET",
    },
    {
      id: "workspace-b",
      workspaceId: "T-B",
      channelIds: [],
      botTokenEnv: "B_BOT",
      appTokenEnv: "B_APP",
      signingSecretEnv: "B_SECRET",
    },
  ],
};

const tokenEnv = {
  A_BOT: "xoxb-a",
  A_APP: "xapp-a",
  A_SECRET: "secret-a",
  B_BOT: "xoxb-b",
  B_APP: "xapp-b",
  B_SECRET: "secret-b",
};

function connection(id: string, workspaceId: string, channelIds: string[] = []): ResolvedSlackConnection {
  return {
    id,
    workspaceId,
    channelIds,
    botToken: `xoxb-${workspaceId}`,
    appToken: `xapp-${workspaceId}`,
    signingSecret: `secret-${workspaceId}`,
  };
}

describe("slack connections", () => {
  it("loads two workspaces from environment variable names", () => {
    const loaded = loadSlackConnections(writeConnections(twoWorkspaces), tokenEnv);
    expect(loaded.map((item) => item.workspaceId)).toEqual(["T-A", "T-B"]);
    expect(loaded[0]?.botToken).toBe("xoxb-a");
    expect(loaded[1]?.channelIds).toEqual([]);
    expect(JSON.stringify(twoWorkspaces)).not.toContain("xoxb-");
  });

  it("rejects a duplicate workspace id", () => {
    const body = {
      connections: [
        twoWorkspaces.connections[0],
        { ...twoWorkspaces.connections[1], workspaceId: "T-A" },
      ],
    };
    expect(() => loadSlackConnections(writeConnections(body), tokenEnv)).toThrow(/duplicate slack workspace: T-A/);
  });

  it("rejects a duplicate connection id", () => {
    const body = {
      connections: [
        twoWorkspaces.connections[0],
        { ...twoWorkspaces.connections[1], id: "workspace-a" },
      ],
    };
    expect(() => loadSlackConnections(writeConnections(body), tokenEnv)).toThrow(/duplicate slack connection id: workspace-a/);
  });

  it("names the connection when a token environment variable is missing", () => {
    expect(() => loadSlackConnections(writeConnections(twoWorkspaces), { ...tokenEnv, A_BOT: "" })).toThrow(
      ConfigError,
    );
    expect(() => loadSlackConnections(writeConnections(twoWorkspaces), { ...tokenEnv, A_BOT: "" })).toThrow(
      /Slack connection "workspace-a" is missing environment variable:\nA_BOT/,
    );
    expect(() => loadSlackConnections(writeConnections(twoWorkspaces), { ...tokenEnv, B_APP: "" })).toThrow(/B_APP/);
    expect(() => loadSlackConnections(writeConnections(twoWorkspaces), { ...tokenEnv, A_SECRET: "" })).toThrow(
      /A_SECRET/,
    );
  });
});

describe("SlackListener", () => {
  it("starts one socket app per workspace and keeps that workspace id", async () => {
    const started: string[] = [];
    const handlers = new Map<string, (args: SlackMessageArgs) => Promise<void>>();
    const received: OrchestrationInput[] = [];
    const replies: string[] = [];
    const connections = [connection("workspace-a", "T-A", ["C-A"]), connection("workspace-b", "T-B")];
    const slack = new SlackConnectionManager(connections, logger, (token) => ({
      async postMessage() {
        replies.push(token);
      },
    }));
    const listener = new SlackListener(
      connections,
      { async handle(input) { received.push(input); } },
      slack,
      logger,
      (connection) => {
        const app: SlackSocketApp = {
          message(handle) {
            handlers.set(connection.workspaceId, handle);
          },
          error() {},
          async start() {
            started.push(connection.workspaceId);
          },
          async stop() {},
        };
        return app;
      },
    );

    await listener.start();
    expect(started).toEqual(["T-A", "T-B"]);

    await handlers.get("T-A")?.({
      message: { type: "message", channel: "C-A", user: "U1", text: "hello", ts: "1" },
      context: {},
      body: {},
    });
    await handlers.get("T-B")?.({
      message: { type: "message", channel: "C-OTHER", user: "U2", text: "there", ts: "2" },
      context: { teamId: "T-B" },
      body: {},
    });
    await handlers.get("T-A")?.({
      message: { type: "message", channel: "C-SKIP", user: "U1", text: "nope", ts: "3" },
      context: { teamId: "T-A" },
      body: {},
    });
    await handlers.get("T-A")?.({
      message: { type: "message", channel: "C-A", user: "U1", text: "wrong workspace", ts: "4" },
      context: { teamId: "T-B" },
      body: {},
    });

    expect(received.map((input) => input.context.workspaceId)).toEqual(["T-A", "T-B"]);
    expect(received[0]?.context.channelId).toBe("C-A");
    expect(received[1]?.context.channelId).toBe("C-OTHER");
  });
});

describe("workspace notifications", () => {
  it("posts with the token of the task workspace", async () => {
    const posted: string[] = [];
    const connections = [connection("workspace-a", "T-A"), connection("workspace-b", "T-B")];
    const slack = new SlackConnectionManager(connections, logger, (token) => ({
      async postMessage() {
        posted.push(token);
      },
    }));
    const notifier = new NotificationService(slack, logger);
    const notice = {
      channel: "C1",
      threadTs: "1",
      summary: "done",
      needsHuman: false,
      humanQuestion: "",
      tasks: [],
    };
    await notifier.notifyTasksCreated({ ...notice, workspaceId: "T-A" });
    await notifier.notifyPlanningFailed({ workspaceId: "T-B", channel: "C2", threadTs: "2" });
    expect(posted).toEqual(["xoxb-T-A", "xoxb-T-B"]);
    await expect(notifier.notifyRouteRejected({
      workspaceId: "T-UNKNOWN",
      channel: "C1",
      threadTs: "1",
      text: "missing",
    })).rejects.toThrow(/unknown slack workspace: T-UNKNOWN/);
    expect(posted).toEqual(["xoxb-T-A", "xoxb-T-B"]);
  });
});
