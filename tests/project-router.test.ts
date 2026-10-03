import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseProjectCatalog } from "../src/routing/project-catalog.js";
import { ProjectRouter } from "../src/routing/project-router.js";
import type { ProjectCatalogFile } from "../src/routing/project.types.js";

function project(name: string, localPath: string): ProjectCatalogFile["projects"][string] {
  return {
    name,
    repository: { mode: "local", localPath, remoteRepository: `koba3/${name}` },
  };
}

const catalog: ProjectCatalogFile = {
  workspaces: {
    a: {
      id: "T-A",
      name: "Workspace A",
      channels: {
        development: {
          id: "C-DEV-A",
          name: "development",
          hashtags: {
            questoon: { projectId: "questoon" },
            luno: { projectId: "luno" },
            backend: { projectId: "project-a" },
          },
        },
        "customer-a": {
          id: "C-CUST-A",
          name: "customer-a",
          hashtags: {
            frontend: { projectId: "customer-a-frontend" },
            backend: { projectId: "customer-a-backend" },
          },
        },
        ops: {
          id: "C-OPS-A",
          name: "ops",
          defaultProject: "questoon",
          hashtags: {
            luno: { projectId: "luno" },
          },
        },
      },
    },
    b: {
      id: "T-B",
      name: "Workspace B",
      channels: {
        development: {
          id: "C-DEV-B",
          name: "development",
          hashtags: {
            questoon: { projectId: "workspace-b-questoon" },
          },
        },
      },
    },
  },
  projects: {
    questoon: project("Questoon", "/Users/koba/projects/questoon"),
    luno: project("LUNO", "/Users/koba/projects/luno"),
    "customer-a-frontend": project("customer-a-frontend", "/Users/koba/projects/customer-a-frontend"),
    "customer-a-backend": project("customer-a-backend", "/Users/koba/projects/customer-a-backend"),
    "project-a": project("project-a", "/Users/koba/projects/project-a"),
    "workspace-b-questoon": project("Workspace B Questoon", "/Users/koba/projects/b-questoon"),
  },
};

const router = new ProjectRouter(catalog);

function resolve(workspaceId: string, channelId: string, text: string) {
  return router.resolve({ text, context: { workspaceId, channelId } });
}

describe("ProjectRouter", () => {
  it("routes workspace A development #questoon to questoon", () => {
    const result = resolve("T-A", "C-DEV-A", "#questoon ログイン画面にGoogle認証を追加して");
    expect(result.ok && result.route.projectId).toBe("questoon");
    if (result.ok) {
      expect(result.route.localPath).toBe("/Users/koba/projects/questoon");
      expect(result.route.source).toBe("hashtag");
      expect(result.route.hashtag).toBe("questoon");
    }
  });

  it("routes workspace A development #luno to luno", () => {
    const result = resolve("T-A", "C-DEV-A", "#luno CMSに検索機能を追加");
    expect(result.ok && result.route.projectId).toBe("luno");
  });

  it("routes workspace A customer-a #frontend to customer-a-frontend", () => {
    const result = resolve("T-A", "C-CUST-A", "#frontend 画面を追加");
    expect(result.ok && result.route.projectId).toBe("customer-a-frontend");
  });

  it("routes the same hashtag in workspace B to that workspace project", () => {
    const result = resolve("T-B", "C-DEV-B", "#questoon 同じ名前");
    expect(result.ok && result.route.projectId).toBe("workspace-b-questoon");
    if (result.ok) {
      expect(result.route.localPath).toBe("/Users/koba/projects/b-questoon");
    }
  });

  it("does not treat an unknown hashtag as a project", () => {
    const result = resolve("T-A", "C-DEV-A", "#unknown 何かして");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("unresolved");
      expect(result.message).toContain("対象プロジェクトを指定してください。");
      expect(result.message).toContain("#questoon");
    }
  });

  it("ignores an unregistered hashtag when a registered one is present", () => {
    const result = resolve("T-A", "C-DEV-A", "#foo #questoon ログイン機能を追加");
    expect(result.ok && result.route.projectId).toBe("questoon");
  });

  it("asks a human when more than one registered hashtag is present", () => {
    const result = resolve("T-A", "C-DEV-A", "#questoon #luno ログイン機能を追加して");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("ambiguous-hashtag");
      expect(result.message).toContain("プロジェクトを1つだけ指定してください。");
    }
  });

  it("asks a human when there is no hashtag and no channel default", () => {
    const result = resolve("T-A", "C-DEV-A", "ログイン機能を追加して");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("unresolved");
    }
  });

  it("uses the channel default only when no registered hashtag is present", () => {
    const fallback = resolve("T-A", "C-OPS-A", "READMEを更新して");
    expect(fallback.ok && fallback.route.projectId).toBe("questoon");
    if (fallback.ok) {
      expect(fallback.route.source).toBe("channel-default");
      expect(fallback.route.hashtag).toBe("");
    }
    const explicit = resolve("T-A", "C-OPS-A", "#luno を更新して");
    expect(explicit.ok && explicit.route.projectId).toBe("luno");
    if (explicit.ok) {
      expect(explicit.route.source).toBe("hashtag");
    }
  });

  it("treats hashtag case as the same project", () => {
    const result = resolve("T-A", "C-DEV-A", "#QUESTOON 追加して");
    expect(result.ok && result.route.projectId).toBe("questoon");
  });

  it("resolves the same hashtag to a different project in another channel", () => {
    const development = resolve("T-A", "C-DEV-A", "#backend APIを追加");
    const customer = resolve("T-A", "C-CUST-A", "#backend APIを追加");
    expect(development.ok && development.route.projectId).toBe("project-a");
    expect(customer.ok && customer.route.projectId).toBe("customer-a-backend");
  });

  it("does not use a filesystem path in the message as a repository", () => {
    const result = resolve("T-A", "C-DEV-A", "#questoon /Users/koba/projects/luno を見て");
    expect(result.ok && result.route.localPath).toBe("/Users/koba/projects/questoon");
  });

  it("loads the example catalog and folds hashtag case", () => {
    const example = parseProjectCatalog(JSON.parse(readFileSync(path.join(process.cwd(), "config/projects.example.json"), "utf8")));
    const folded = parseProjectCatalog({
      workspaces: {
        bespoke: {
          id: "T1",
          name: "ビスポーク",
          channels: {
            development: {
              id: "C1",
              name: "development",
              hashtags: { Questoon: { projectId: "questoon" } },
            },
          },
        },
      },
      projects: example.projects,
    });
    expect(example.inputs?.[0]?.connection.workspaceId).toBe("TXXXXXXXX");
    const routed = new ProjectRouter(folded).resolve({
      text: "#questoon",
      context: { workspaceId: "T1", channelId: "C1" },
    });
    expect(routed.ok && routed.route.projectId).toBe("questoon");
  });
});
