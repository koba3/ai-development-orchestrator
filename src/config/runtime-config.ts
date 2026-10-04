import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";
import type { ProjectAgentLink } from "../orchestration/orchestration.types.js";
import { loadProjectCatalog, parseProjectCatalog } from "../routing/project-catalog.js";
import { normalizeHashtag } from "../routing/hashtags.js";
import type { ProjectCatalogFile } from "../routing/project.types.js";
import { loadSlackConnections, type ResolvedSlackConnection } from "../slack/slack-connections.js";
import type { AppLogger } from "../utils/logger.js";
import { ConfigError, formatConfigError } from "./index.js";
import { decryptSecret, deriveEncryptionKey, encryptSecret } from "./secret-box.js";

const encryptedSecretSchema = z.object({
  iv: z.string().min(1),
  tag: z.string().min(1),
  ciphertext: z.string().min(1),
});

const storedSlackSchema = z.object({
  id: z.string().min(1),
  workspaceId: z.string().min(1),
  channelIds: z.array(z.string().min(1)).default([]),
  enabled: z.boolean().default(true),
  botToken: encryptedSecretSchema,
  appToken: encryptedSecretSchema,
  signingSecret: encryptedSecretSchema,
});

const storedFileSchema = z.object({
  version: z.literal(1),
  slackConnections: z.array(storedSlackSchema),
  projectCatalog: z.unknown(),
});

const slackDraftSchema = z.object({
  connections: z.array(z.object({
    id: z.string().min(1),
    workspaceId: z.string().min(1),
    channelIds: z.array(z.string().min(1)).default([]),
    enabled: z.boolean().default(true),
    botToken: z.string().default(""),
    appToken: z.string().default(""),
    signingSecret: z.string().default(""),
  })),
});

const projectSettingsSchema = z.object({
  projects: z.array(z.object({
    projectId: z.string().min(1),
    name: z.string().min(1),
    localRepository: z.string().min(1),
    remoteRepository: z.string().default(""),
    repositoryMode: z.literal("local"),
  })),
  routes: z.array(z.object({
    workspaceId: z.string().min(1),
    workspaceName: z.string().min(1),
    channelId: z.string().min(1),
    channelName: z.string().min(1),
    hashtag: z.string().min(1),
    projectId: z.string().min(1),
  })),
});

export interface PublicSlackConnection {
  id: string;
  workspaceId: string;
  channelIds: string[];
  enabled: boolean;
  botTokenSet: boolean;
  appTokenSet: boolean;
  signingSecretSet: boolean;
}

export interface ProjectSettings {
  projects: Array<{
    projectId: string;
    name: string;
    localRepository: string;
    remoteRepository: string;
    repositoryMode: "local";
  }>;
  routes: Array<{
    workspaceId: string;
    workspaceName: string;
    channelId: string;
    channelName: string;
    hashtag: string;
    projectId: string;
  }>;
}

interface RuntimeState {
  slack: ResolvedSlackConnection[];
  catalog: ProjectCatalogFile;
}

export interface RuntimeConfigurationOptions {
  storePath: string;
  encryptionKey: string;
  legacySlackPath: string;
  legacyProjectsPath: string;
  logger: AppLogger;
}

export class RuntimeConfiguration {
  private constructor(
    private readonly storePath: string,
    private readonly key: Buffer,
    private readonly logger: AppLogger,
    private state: RuntimeState,
  ) {}

  static open(options: RuntimeConfigurationOptions): RuntimeConfiguration {
    const key = deriveEncryptionKey(options.encryptionKey);
    const runtime = new RuntimeConfiguration(options.storePath, key, options.logger, {
      slack: [],
      catalog: { workspaces: {}, projects: {} },
    });
    if (existsSync(options.storePath)) {
      runtime.state = runtime.readState();
      runtime.logger.info(
        { event: "config.loaded", status: "READY", slackConnections: runtime.state.slack.length },
        "loaded runtime configuration",
      );
      return runtime;
    }
    runtime.state = importLegacy(options);
    runtime.persist();
    runtime.logger.info(
      {
        event: "config.imported",
        status: "READY",
        slackConnections: runtime.state.slack.length,
        projects: Object.keys(runtime.state.catalog.projects).length,
      },
      "imported runtime configuration",
    );
    return runtime;
  }

  slackConnections(): ResolvedSlackConnection[] {
    return this.state.slack.map((connection) => ({ ...connection, channelIds: [...connection.channelIds] }));
  }

  publicSlack(): PublicSlackConnection[] {
    return this.state.slack.map(toPublicSlack);
  }

  projectCatalog(): ProjectCatalogFile {
    return this.state.catalog;
  }

  projectSettings(): ProjectSettings {
    return toProjectSettings(this.state.catalog);
  }

  replaceSlack(raw: unknown): PublicSlackConnection[] {
    const parsed = slackDraftSchema.safeParse(raw);
    if (!parsed.success) {
      throw new ConfigError(`Slack 設定が不正です\n${formatConfigError(parsed.error)}`);
    }
    const seenIds = new Set<string>();
    const seenWorkspaces = new Set<string>();
    const next: ResolvedSlackConnection[] = [];
    for (const draft of parsed.data.connections) {
      if (seenIds.has(draft.id)) {
        throw new ConfigError(`Slack の接続 ID が重複しています: ${draft.id}`);
      }
      if (seenWorkspaces.has(draft.workspaceId)) {
        throw new ConfigError(`Slack の workspace が重複しています: ${draft.workspaceId}`);
      }
      seenIds.add(draft.id);
      seenWorkspaces.add(draft.workspaceId);
      const previous = this.state.slack.find((connection) => connection.id === draft.id);
      const botToken = draft.botToken || previous?.botToken || "";
      const appToken = draft.appToken || previous?.appToken || "";
      const signingSecret = draft.signingSecret || previous?.signingSecret || "";
      if (!botToken) {
        throw new ConfigError(`Slack 接続 "${draft.id}" の botToken がありません`);
      }
      if (!appToken) {
        throw new ConfigError(`Slack 接続 "${draft.id}" の appToken がありません`);
      }
      if (!signingSecret) {
        throw new ConfigError(`Slack 接続 "${draft.id}" の signingSecret がありません`);
      }
      next.push({
        id: draft.id,
        workspaceId: draft.workspaceId,
        channelIds: draft.channelIds,
        enabled: draft.enabled,
        botToken,
        appToken,
        signingSecret,
      });
    }
    this.state = { ...this.state, slack: next };
    this.persist();
    this.logger.info(
      { event: "config.slack.saved", status: "READY", connectionIds: next.map((connection) => connection.id) },
      "saved slack runtime configuration",
    );
    return this.publicSlack();
  }

  replaceProjects(raw: unknown): ProjectSettings {
    const parsed = projectSettingsSchema.safeParse(raw);
    if (!parsed.success) {
      throw new ConfigError(`Project 設定が不正です\n${formatConfigError(parsed.error)}`);
    }
    const catalog = parseProjectCatalog(buildCatalog(parsed.data, this.state.catalog));
    this.state = { ...this.state, catalog };
    this.persist();
    this.logger.info(
      { event: "config.projects.saved", status: "READY", projects: Object.keys(catalog.projects) },
      "saved project runtime configuration",
    );
    return this.projectSettings();
  }

  private readState(): RuntimeState {
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(this.storePath, "utf8")) as unknown;
    } catch {
      throw new ConfigError(`runtime configuration is not valid JSON: ${this.storePath}`);
    }
    const parsed = storedFileSchema.safeParse(raw);
    if (!parsed.success) {
      throw new ConfigError(`runtime configuration is invalid: ${this.storePath}\n${formatConfigError(parsed.error)}`);
    }
    let catalog: ProjectCatalogFile;
    try {
      catalog = parseProjectCatalog(parsed.data.projectCatalog);
    } catch (error) {
      if (error instanceof ConfigError) {
        throw new ConfigError(`runtime project catalog is invalid: ${this.storePath}\n${error.message}`);
      }
      throw error;
    }
    const slack = parsed.data.slackConnections.map((connection) => {
      try {
        return {
          id: connection.id,
          workspaceId: connection.workspaceId,
          channelIds: connection.channelIds,
          enabled: connection.enabled,
          botToken: decryptSecret(connection.botToken, this.key),
          appToken: decryptSecret(connection.appToken, this.key),
          signingSecret: decryptSecret(connection.signingSecret, this.key),
        };
      } catch {
        throw new ConfigError("runtime configuration cannot be decrypted with ENCRYPTION_KEY");
      }
    });
    return { slack, catalog };
  }

  private persist(): void {
    const body = {
      version: 1 as const,
      slackConnections: this.state.slack.map((connection) => ({
        id: connection.id,
        workspaceId: connection.workspaceId,
        channelIds: connection.channelIds,
        enabled: connection.enabled !== false,
        botToken: encryptSecret(connection.botToken, this.key),
        appToken: encryptSecret(connection.appToken, this.key),
        signingSecret: encryptSecret(connection.signingSecret, this.key),
      })),
      projectCatalog: this.state.catalog,
    };
    const directory = dirname(this.storePath);
    mkdirSync(directory, { recursive: true });
    const temporary = `${this.storePath}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(body, null, 2)}\n`, { mode: 0o600 });
    renameSync(temporary, this.storePath);
  }
}

export function openRuntimeConfiguration(options: RuntimeConfigurationOptions): RuntimeConfiguration {
  return RuntimeConfiguration.open(options);
}

function importLegacy(options: RuntimeConfigurationOptions): RuntimeState {
  const slack = existsSync(options.legacySlackPath)
    ? loadSlackConnections(options.legacySlackPath).map((connection) => ({ ...connection, enabled: true }))
    : [];
  const loaded = loadProjectCatalog(options.legacyProjectsPath);
  return { slack, catalog: loaded.catalog };
}

function routeHashtag(value: string): string {
  return normalizeHashtag(value).replace(/^#+/, "");
}

function toPublicSlack(connection: ResolvedSlackConnection): PublicSlackConnection {
  return {
    id: connection.id,
    workspaceId: connection.workspaceId,
    channelIds: [...connection.channelIds],
    enabled: connection.enabled !== false,
    botTokenSet: connection.botToken.length > 0,
    appTokenSet: connection.appToken.length > 0,
    signingSecretSet: connection.signingSecret.length > 0,
  };
}

export function toProjectSettings(catalog: ProjectCatalogFile): ProjectSettings {
  const projects = Object.entries(catalog.projects).map(([projectId, project]) => ({
    projectId,
    name: project.name,
    localRepository: project.repository.localPath,
    remoteRepository: project.repository.remoteRepository,
    repositoryMode: "local" as const,
  }));
  const routes: ProjectSettings["routes"] = [];
  for (const workspace of Object.values(catalog.workspaces)) {
    for (const channel of Object.values(workspace.channels)) {
      for (const [hashtag, config] of Object.entries(channel.hashtags)) {
        routes.push({
          workspaceId: workspace.id,
          workspaceName: workspace.name,
          channelId: channel.id,
          channelName: channel.name,
          hashtag,
          projectId: config.projectId,
        });
      }
    }
  }
  return { projects, routes };
}

function buildCatalog(settings: ProjectSettings, previous: ProjectCatalogFile): ProjectCatalogFile {
  const seenProjects = new Set<string>();
  const projects: ProjectCatalogFile["projects"] = {};
  for (const project of settings.projects) {
    if (seenProjects.has(project.projectId)) {
      throw new ConfigError(`Project ID が重複しています: ${project.projectId}`);
    }
    seenProjects.add(project.projectId);
    projects[project.projectId] = {
      name: project.name,
      repository: {
        mode: "local",
        localPath: project.localRepository,
        remoteRepository: project.remoteRepository,
      },
    };
  }

  const workspaces: ProjectCatalogFile["workspaces"] = {};
  const seenRoutes = new Set<string>();
  for (const route of settings.routes) {
    const hashtag = routeHashtag(route.hashtag);
    if (hashtag.length === 0) {
      throw new ConfigError("hashtag is empty");
    }
    if (!projects[route.projectId]) {
      throw new ConfigError(`hashtag #${hashtag} points at unknown project ${route.projectId}`);
    }
    const routeKey = `${route.workspaceId}:${route.channelId}:${hashtag}`;
    if (seenRoutes.has(routeKey)) {
      throw new ConfigError(`hashtag #${hashtag} maps to more than one project`);
    }
    seenRoutes.add(routeKey);
    const workspace = workspaces[route.workspaceId] ?? {
      id: route.workspaceId,
      name: route.workspaceName,
      channels: {},
    };
    if (workspace.name !== route.workspaceName) {
      throw new ConfigError(`workspace ${route.workspaceId} has more than one name`);
    }
    const channel = workspace.channels[route.channelId] ?? {
      id: route.channelId,
      name: route.channelName,
      hashtags: {},
    };
    if (channel.name !== route.channelName) {
      throw new ConfigError(`channel ${route.channelId} has more than one name`);
    }
    channel.hashtags[hashtag] = { projectId: route.projectId };
    workspace.channels[route.channelId] = channel;
    workspaces[route.workspaceId] = workspace;
  }

  for (const workspace of Object.values(previous.workspaces)) {
    const nextWorkspace = workspaces[workspace.id] ?? {
      id: workspace.id,
      name: workspace.name,
      channels: {},
    };
    for (const channel of Object.values(workspace.channels)) {
      if (!channel.defaultProject || !projects[channel.defaultProject]) {
        continue;
      }
      const nextChannel = nextWorkspace.channels[channel.id] ?? {
        id: channel.id,
        name: channel.name,
        hashtags: {},
      };
      nextChannel.defaultProject = channel.defaultProject;
      nextWorkspace.channels[channel.id] = nextChannel;
    }
    if (Object.keys(nextWorkspace.channels).length > 0) {
      workspaces[workspace.id] = nextWorkspace;
    }
  }

  const previousLinks = previous.agentLinks ?? Object.keys(previous.projects).map((projectId): ProjectAgentLink => ({
    projectId,
    role: "coding",
    agent: "claude",
  }));
  const agentLinks: ProjectAgentLink[] = [];
  for (const projectId of Object.keys(projects)) {
    const kept = previousLinks.filter((link) => link.projectId === projectId);
    if (kept.length > 0) {
      agentLinks.push(...kept);
    } else {
      agentLinks.push({ projectId, role: "coding", agent: "claude" });
    }
  }

  return { workspaces, projects, agentLinks };
}
