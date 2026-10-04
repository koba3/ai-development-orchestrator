import { extractHashtags } from "./hashtags.js";
import type {
  ChannelConfig,
  ProjectCatalogFile,
  ProjectRoute,
  ProjectRouteResult,
  WorkspaceConfig,
} from "./project.types.js";
import type { RoutingInput } from "./routing.js";

const FALLBACK_EXAMPLE = "#questoon";

export class ProjectRouter {
  constructor(private catalog: ProjectCatalogFile) {}

  replace(catalog: ProjectCatalogFile): void {
    this.catalog = catalog;
  }

  resolve(input: RoutingInput): ProjectRouteResult {
    const workspaceId = input.context.workspaceId ?? "";
    const channelId = input.context.channelId ?? "";
    const workspace = Object.values(this.catalog.workspaces).find((item) => item.id === workspaceId);
    if (!workspace) {
      return { ok: false, reason: "unknown-workspace", message: specifyProject(FALLBACK_EXAMPLE) };
    }
    const channel = Object.values(workspace.channels).find((item) => item.id === channelId);
    if (!channel) {
      return { ok: false, reason: "unknown-channel", message: specifyProject(FALLBACK_EXAMPLE) };
    }

    const example = exampleHashtag(channel);
    const registered = extractHashtags(input.text).filter((tag) => channel.hashtags[tag]);
    if (registered.length > 1) {
      return { ok: false, reason: "ambiguous-hashtag", message: specifyOneProject(example) };
    }
    if (registered.length === 1) {
      const hashtag = registered[0] ?? "";
      const projectId = channel.hashtags[hashtag]?.projectId ?? "";
      const route = this.routeFor(workspace, channel, hashtag, projectId, "hashtag");
      if (!route) {
        return { ok: false, reason: "unresolved", message: specifyProject(example) };
      }
      return { ok: true, route };
    }
    if (channel.defaultProject) {
      const route = this.routeFor(workspace, channel, "", channel.defaultProject, "channel-default");
      if (!route) {
        return { ok: false, reason: "unresolved", message: specifyProject(example) };
      }
      return { ok: true, route };
    }
    return { ok: false, reason: "unresolved", message: specifyProject(example) };
  }

  private routeFor(
    workspace: WorkspaceConfig,
    channel: ChannelConfig,
    hashtag: string,
    projectId: string,
    source: ProjectRoute["source"],
  ): ProjectRoute | null {
    const project = this.catalog.projects[projectId];
    if (!project) {
      return null;
    }
    return {
      workspaceId: workspace.id,
      channelId: channel.id,
      hashtag,
      projectId,
      projectName: project.name,
      repositoryMode: project.repository.mode,
      localPath: project.repository.localPath,
      remoteRepository: project.repository.remoteRepository,
      source,
    };
  }
}

function exampleHashtag(channel: ChannelConfig): string {
  const tag = Object.keys(channel.hashtags)[0];
  return tag ? `#${tag}` : FALLBACK_EXAMPLE;
}

function specifyProject(example: string): string {
  return `対象プロジェクトを指定してください。\n例: ${example}`;
}

function specifyOneProject(example: string): string {
  return `プロジェクトを1つだけ指定してください。\n例: ${example}`;
}
