import type { InputSource, ProjectAgentLink } from "../orchestration/orchestration.types.js";
import type { ProjectRepository } from "../project/project.js";

export interface ProjectConfig {
  name: string;
  repository: ProjectRepository;
}

export interface HashtagConfig {
  projectId: string;
}

export interface ChannelConfig {
  id: string;
  name: string;
  defaultProject?: string;
  hashtags: Record<string, HashtagConfig>;
}

export interface WorkspaceConfig {
  id: string;
  name: string;
  channels: Record<string, ChannelConfig>;
}

export interface ProjectCatalogFile {
  workspaces: Record<string, WorkspaceConfig>;
  projects: Record<string, ProjectConfig>;
  inputs?: InputSource[];
  agentLinks?: ProjectAgentLink[];
}

export type ProjectRouteSource = "hashtag" | "channel-default";

export interface ProjectRoute {
  workspaceId: string;
  channelId: string;
  hashtag: string;
  projectId: string;
  projectName: string;
  repositoryMode: string;
  localPath: string;
  remoteRepository: string;
  source: ProjectRouteSource;
}

export type ProjectRouteFailureReason = "unknown-workspace" | "unknown-channel" | "ambiguous-hashtag" | "unresolved";

export type ProjectRouteResult =
  | { ok: true; route: ProjectRoute }
  | { ok: false; reason: ProjectRouteFailureReason; message: string };
