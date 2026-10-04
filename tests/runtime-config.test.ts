import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { handleConfigHttp } from "../src/config/config-http.js";
import { openRuntimeConfiguration } from "../src/config/runtime-config.js";
import { startHealthServer } from "../src/health/health.server.js";
import { ProjectRouter } from "../src/routing/project-router.js";
import { createLogger } from "../src/utils/logger.js";

const logger = createLogger({ level: "silent" });
const encryptionKey = "test-encryption-key";
const adminToken = "test-admin-token-value";
const servers: Array<{ close: (callback: (error?: Error) => void) => void }> = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  })));
});

describe("runtime configuration", () => {
  it("imports legacy files once and stores slack secrets encrypted", () => {
    const directory = mkdtempSync(join(tmpdir(), "orchestrator-config-"));
    const slackPath = join(directory, "slack.json");
    const projectsPath = join(directory, "projects.json");
    const storePath = join(directory, "runtime.json");
    writeFileSync(slackPath, JSON.stringify({
      connections: [{
        id: "workspace-a",
        workspaceId: "T-A",
        channelIds: ["C-A"],
        botTokenEnv: "A_BOT",
        appTokenEnv: "A_APP",
        signingSecretEnv: "A_SECRET",
      }],
    }));
    writeFileSync(projectsPath, JSON.stringify({
      workspaces: {
        main: {
          id: "T-A",
          name: "Main",
          channels: {
            dev: { id: "C-A", name: "dev", hashtags: { questoon: { projectId: "questoon" } } },
          },
        },
      },
      projects: {
        questoon: {
          name: "Questoon",
          repository: { mode: "local", localPath: "/tmp/questoon", remoteRepository: "git@github.com:org/questoon.git" },
        },
      },
      agentLinks: [{ projectId: "questoon", role: "coding", agent: "codex" }],
    }));
    const previousEnv = {
      A_BOT: process.env.A_BOT,
      A_APP: process.env.A_APP,
      A_SECRET: process.env.A_SECRET,
    };
    process.env.A_BOT = "xoxb-imported";
    process.env.A_APP = "xapp-imported";
    process.env.A_SECRET = "secret-imported";
    try {
      const runtime = openRuntimeConfiguration({
        storePath,
        encryptionKey,
        legacySlackPath: slackPath,
        legacyProjectsPath: projectsPath,
        logger,
      });
      expect(runtime.slackConnections()[0]?.botToken).toBe("xoxb-imported");
      expect(runtime.projectSettings().projects[0]?.projectId).toBe("questoon");
      const disk = readFileSync(storePath, "utf8");
      expect(disk).not.toContain("xoxb-imported");
      expect(disk).not.toContain("xapp-imported");
      expect(disk).not.toContain("secret-imported");

      process.env.A_BOT = "xoxb-changed";
      writeFileSync(slackPath, JSON.stringify({
        connections: [{
          id: "workspace-a",
          workspaceId: "T-CHANGED",
          botTokenEnv: "A_BOT",
          appTokenEnv: "A_APP",
          signingSecretEnv: "A_SECRET",
        }],
      }));
      const reloaded = openRuntimeConfiguration({
        storePath,
        encryptionKey,
        legacySlackPath: slackPath,
        legacyProjectsPath: projectsPath,
        logger,
      });
      expect(reloaded.slackConnections()[0]?.workspaceId).toBe("T-A");
      expect(reloaded.slackConnections()[0]?.botToken).toBe("xoxb-imported");
    } finally {
      restoreEnv(previousEnv);
    }
  });

  it("keeps a blank secret and rejects a new connection without one", () => {
    const runtime = openRuntime(mkdtempSync(join(tmpdir(), "orchestrator-config-")));
    runtime.replaceSlack({
      connections: [{
        id: "workspace-a",
        workspaceId: "T-A",
        channelIds: ["C-A"],
        enabled: true,
        botToken: "xoxb-a",
        appToken: "xapp-a",
        signingSecret: "secret-a",
      }],
    });
    const kept = runtime.replaceSlack({
      connections: [{
        id: "workspace-a",
        workspaceId: "T-A",
        channelIds: [],
        enabled: false,
        botToken: "",
        appToken: "",
        signingSecret: "",
      }],
    });
    expect(kept[0]).toMatchObject({ enabled: false, botTokenSet: true, channelIds: [] });
    expect(runtime.slackConnections()[0]?.botToken).toBe("xoxb-a");
    expect(JSON.stringify(kept)).not.toContain("xoxb-a");
    expect(() => runtime.replaceSlack({
      connections: [{ id: "workspace-b", workspaceId: "T-B", botToken: "", appToken: "", signingSecret: "" }],
    })).toThrow(/botToken/);
    expect(() => runtime.replaceSlack({
      connections: [
        { id: "workspace-a", workspaceId: "T-A", botToken: "xoxb-a", appToken: "xapp-a", signingSecret: "secret-a" },
        { id: "workspace-b", workspaceId: "T-A", botToken: "xoxb-b", appToken: "xapp-b", signingSecret: "secret-b" },
      ],
    })).toThrow(/workspace が重複しています: T-A/);
  });

  it("saves projects and keeps the existing coding agent link", () => {
    const directory = mkdtempSync(join(tmpdir(), "orchestrator-config-"));
    const projectsPath = join(directory, "projects.json");
    writeFileSync(projectsPath, JSON.stringify({
      projects: {
        questoon: {
          name: "Questoon",
          repository: { mode: "local", localPath: "/tmp/questoon", remoteRepository: "" },
        },
      },
      agentLinks: [{ projectId: "questoon", role: "coding", agent: "codex" }],
    }));
    const runtime = openRuntimeConfiguration({
      storePath: join(directory, "runtime.json"),
      encryptionKey,
      legacySlackPath: join(directory, "missing-slack.json"),
      legacyProjectsPath: projectsPath,
      logger,
    });
    const saved = runtime.replaceProjects({
      projects: [{
        projectId: "questoon",
        name: "Questoon App",
        localRepository: "/tmp/questoon",
        remoteRepository: "git@github.com:org/questoon.git",
        repositoryMode: "local",
      }, {
        projectId: "other",
        name: "Other",
        localRepository: "/tmp/other",
        remoteRepository: "",
        repositoryMode: "local",
      }],
      routes: [{
        workspaceId: "T-A",
        workspaceName: "Main",
        channelId: "C-A",
        channelName: "dev",
        hashtag: "#Questoon",
        projectId: "questoon",
      }],
    });
    expect(saved.routes[0]?.hashtag).toBe("questoon");
    expect(runtime.projectCatalog().agentLinks).toEqual([
      { projectId: "questoon", role: "coding", agent: "codex" },
      { projectId: "other", role: "coding", agent: "claude" },
    ]);
    const router = new ProjectRouter(runtime.projectCatalog());
    const resolved = router.resolve({ text: "#questoon 追加して", context: { workspaceId: "T-A", channelId: "C-A" } });
    expect(resolved.ok).toBe(true);
    if (resolved.ok) {
      expect(resolved.route.localPath).toBe("/tmp/questoon");
    }
  });

  it("refuses the admin API without the admin token and does not return secrets", async () => {
    const runtime = openRuntime(mkdtempSync(join(tmpdir(), "orchestrator-config-")));
    runtime.replaceSlack({
      connections: [{
        id: "workspace-a",
        workspaceId: "T-A",
        botToken: "xoxb-hidden",
        appToken: "xapp-hidden",
        signingSecret: "secret-hidden",
      }],
    });
    const server = await startHealthServer(0, (request, response) => handleConfigHttp(request, response, {
      adminToken,
      runtime,
      logger,
      async reloadSlack() {},
      reloadProjects() {},
    }));
    servers.push(server);
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("expected a tcp address");
    }
    const base = `http://127.0.0.1:${address.port}`;
    const denied = await fetch(`${base}/api/config/slack`);
    expect(denied.status).toBe(401);
    const page = await fetch(`${base}/admin`);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("Orchestrator 設定");
    const listed = await fetch(`${base}/api/config/slack`, {
      headers: { authorization: `Bearer ${adminToken}` },
    });
    const body = await listed.json();
    expect(JSON.stringify(body)).not.toContain("xoxb-hidden");
    expect(body.connections[0].botTokenSet).toBe(true);
  });

  it("rejects a store encrypted with a different key", () => {
    const directory = mkdtempSync(join(tmpdir(), "orchestrator-config-"));
    const storePath = join(directory, "runtime.json");
    openRuntime(directory).replaceSlack({
      connections: [{
        id: "workspace-a",
        workspaceId: "T-A",
        botToken: "xoxb-a",
        appToken: "xapp-a",
        signingSecret: "secret-a",
      }],
    });
    expect(() => openRuntimeConfiguration({
      storePath,
      encryptionKey: "another-encryption-key",
      legacySlackPath: join(directory, "missing-slack.json"),
      legacyProjectsPath: join(directory, "missing-projects.json"),
      logger,
    })).toThrow(/cannot be decrypted/);
  });
});

function openRuntime(directory: string) {
  return openRuntimeConfiguration({
    storePath: join(directory, "runtime.json"),
    encryptionKey,
    legacySlackPath: join(directory, "missing-slack.json"),
    legacyProjectsPath: join(directory, "missing-projects.json"),
    logger,
  });
}

function restoreEnv(values: Record<string, string | undefined>): void {
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}
