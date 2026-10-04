import { existsSync, readFileSync } from "node:fs";
import { z } from "zod";
import { ConfigError, formatConfigError } from "../config/index.js";

export interface SlackConnectionConfig {
  id: string;
  workspaceId: string;
  channelIds: string[];
  botTokenEnv: string;
  appTokenEnv: string;
  signingSecretEnv: string;
}

export interface ResolvedSlackConnection {
  id: string;
  workspaceId: string;
  channelIds: string[];
  enabled?: boolean;
  botToken: string;
  appToken: string;
  signingSecret: string;
}

const connectionSchema = z.object({
  id: z.string().min(1),
  workspaceId: z.string().min(1),
  channelIds: z.array(z.string().min(1)).optional().default([]),
  botTokenEnv: z.string().min(1),
  appTokenEnv: z.string().min(1),
  signingSecretEnv: z.string().min(1),
});

const fileSchema = z.object({
  connections: z.array(connectionSchema).min(1),
});

export function loadSlackConnections(
  filePath: string,
  env: NodeJS.ProcessEnv = process.env,
): ResolvedSlackConnection[] {
  if (!existsSync(filePath)) {
    throw new ConfigError(`SLACK_CONNECTIONS_CONFIG is missing: ${filePath}`);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(filePath, "utf8")) as unknown;
  } catch {
    throw new ConfigError(`SLACK_CONNECTIONS_CONFIG is not valid JSON: ${filePath}`);
  }
  const parsed = fileSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ConfigError(`SLACK_CONNECTIONS_CONFIG is invalid: ${filePath}\n${formatConfigError(parsed.error)}`);
  }
  const seenIds = new Set<string>();
  const seenWorkspaces = new Set<string>();
  const missing: string[] = [];
  const resolved: ResolvedSlackConnection[] = [];
  for (const connection of parsed.data.connections) {
    if (seenIds.has(connection.id)) {
      throw new ConfigError(`duplicate slack connection id: ${connection.id}`);
    }
    if (seenWorkspaces.has(connection.workspaceId)) {
      throw new ConfigError(`duplicate slack workspace: ${connection.workspaceId}`);
    }
    seenIds.add(connection.id);
    seenWorkspaces.add(connection.workspaceId);
    const botToken = readConnectionEnv(env, connection.id, connection.botTokenEnv, missing);
    const appToken = readConnectionEnv(env, connection.id, connection.appTokenEnv, missing);
    const signingSecret = readConnectionEnv(env, connection.id, connection.signingSecretEnv, missing);
    if (botToken && appToken && signingSecret) {
      resolved.push({
        id: connection.id,
        workspaceId: connection.workspaceId,
        channelIds: connection.channelIds,
        enabled: true,
        botToken,
        appToken,
        signingSecret,
      });
    }
  }
  if (missing.length > 0) {
    throw new ConfigError(missing.join("\n"));
  }
  return resolved;
}

function readConnectionEnv(
  env: NodeJS.ProcessEnv,
  connectionId: string,
  name: string,
  missing: string[],
): string | undefined {
  const value = env[name]?.trim() ?? "";
  if (value.length === 0) {
    missing.push(`Slack connection "${connectionId}" is missing environment variable:\n${name}`);
    return undefined;
  }
  return value;
}
