import { existsSync, readFileSync } from "node:fs";
import { z } from "zod";
import { ConfigError, formatConfigError } from "../config/index.js";
import { AGENT_KINDS, AGENT_ROLES } from "../orchestration/orchestration.types.js";
import { normalizeHashtag } from "./hashtags.js";
import type { ChannelConfig, HashtagConfig, ProjectCatalogFile, WorkspaceConfig } from "./project.types.js";

const hashtagSchema = z.object({
  projectId: z.string().min(1),
});

const channelSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  defaultProject: z.string().min(1).optional(),
  hashtags: z.record(z.string(), hashtagSchema).default({}),
});

const workspaceSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  channels: z.record(z.string(), channelSchema).default({}),
});

const projectSchema = z.object({
  name: z.string().min(1),
  repository: z.object({
    mode: z.literal("local"),
    localPath: z.string().min(1),
    remoteRepository: z.string().optional().default(""),
  }),
});

const slackInputSchema = z.object({
  id: z.string().min(1),
  type: z.literal("slack"),
  name: z.string().min(1),
  enabled: z.boolean().default(true),
  workspaceId: z.string().min(1),
});

const agentLinkSchema = z.object({
  projectId: z.string().min(1),
  role: z.enum(AGENT_ROLES),
  agent: z.enum(AGENT_KINDS),
});

const projectCatalogSchema = z.object({
  inputs: z.array(slackInputSchema).optional(),
  workspaces: z.record(z.string(), workspaceSchema).default({}),
  projects: z.record(z.string(), projectSchema).default({}),
  agentLinks: z.array(agentLinkSchema).optional(),
});

export function parseProjectCatalog(raw: unknown): ProjectCatalogFile {
  const parsed = projectCatalogSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ConfigError(`PROJECTS_CONFIG is invalid\n${formatConfigError(parsed.error)}`);
  }
  return normalizeCatalog(parsed.data);
}

export function loadProjectCatalog(filePath: string): { catalog: ProjectCatalogFile; missing: boolean } {
  if (!existsSync(filePath)) {
    return { catalog: { workspaces: {}, projects: {} }, missing: true };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(filePath, "utf8")) as unknown;
  } catch {
    throw new ConfigError(`PROJECTS_CONFIG is not valid JSON: ${filePath}`);
  }
  try {
    return { catalog: parseProjectCatalog(raw), missing: false };
  } catch (error) {
    if (error instanceof ConfigError) {
      throw new ConfigError(`PROJECTS_CONFIG is invalid: ${filePath}\n${error.message}`);
    }
    throw error;
  }
}

function normalizeCatalog(catalog: ProjectCatalogFile): ProjectCatalogFile {
  const workspaces: Record<string, WorkspaceConfig> = {};
  for (const [key, workspace] of Object.entries(catalog.workspaces)) {
    const channels: Record<string, ChannelConfig> = {};
    for (const [channelKey, channel] of Object.entries(workspace.channels)) {
      channels[channelKey] = {
        ...channel,
        hashtags: normalizeHashtags(channel.hashtags),
      };
    }
    workspaces[key] = { ...workspace, channels };
  }
  const normalized: ProjectCatalogFile = {
    inputs: catalog.inputs,
    workspaces,
    projects: catalog.projects,
    agentLinks: catalog.agentLinks,
  };
  assertReferences(normalized);
  return normalized;
}

function normalizeHashtags(hashtags: Record<string, HashtagConfig>): Record<string, HashtagConfig> {
  const normalized: Record<string, HashtagConfig> = {};
  for (const [key, value] of Object.entries(hashtags)) {
    const tag = normalizeHashtag(key);
    const existing = normalized[tag];
    if (existing && existing.projectId !== value.projectId) {
      throw new ConfigError(`hashtag #${tag} maps to more than one project`);
    }
    normalized[tag] = value;
  }
  return normalized;
}

function assertReferences(catalog: ProjectCatalogFile): void {
  for (const workspace of Object.values(catalog.workspaces)) {
    for (const channel of Object.values(workspace.channels)) {
      if (channel.defaultProject && !catalog.projects[channel.defaultProject]) {
        throw new ConfigError(`default project ${channel.defaultProject} is not defined`);
      }
      for (const [tag, hashtag] of Object.entries(channel.hashtags)) {
        if (!catalog.projects[hashtag.projectId]) {
          throw new ConfigError(`hashtag #${tag} points at unknown project ${hashtag.projectId}`);
        }
      }
    }
  }
  const seenWorkspaces = new Set<string>();
  for (const input of catalog.inputs ?? []) {
    if (![...Object.values(catalog.workspaces)].some((workspace) => workspace.id === input.workspaceId)) {
      throw new ConfigError(`slack input ${input.id} points at unknown workspace ${input.workspaceId}`);
    }
    if (seenWorkspaces.has(input.workspaceId)) {
      throw new ConfigError(`workspace ${input.workspaceId} has more than one slack input`);
    }
    seenWorkspaces.add(input.workspaceId);
  }
  const seenLinks = new Set<string>();
  for (const link of catalog.agentLinks ?? []) {
    if (!catalog.projects[link.projectId]) {
      throw new ConfigError(`agent link points at unknown project ${link.projectId}`);
    }
    const key = `${link.projectId}:${link.role}`;
    if (seenLinks.has(key)) {
      throw new ConfigError(`project ${link.projectId} has more than one ${link.role} agent`);
    }
    seenLinks.add(key);
  }
}
