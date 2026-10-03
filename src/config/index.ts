import { z } from "zod";

const PLANNER_PROVIDERS = ["openai", "anthropic"] as const;

export type PlannerProvider = (typeof PLANNER_PROVIDERS)[number];

const envSchema = z
  .object({
    PORT: z.coerce.number().int().positive().default(3000),
    LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
    SLACK_BOT_TOKEN: z.string().min(1),
    SLACK_APP_TOKEN: z.string().min(1),
    SLACK_SIGNING_SECRET: z.string().min(1),
    SLACK_CHANNEL_IDS: z.string().optional().default(""),
    NOTION_TOKEN: z.string().min(1),
    NOTION_TASK_DATABASE_ID: z.string().min(1),
    PLANNER_PROVIDER: z.string().optional().default(""),
    LLM_PROVIDER: z.string().optional().default(""),
    OPENAI_API_KEY: z.string().optional().default(""),
    OPENAI_MODEL: z.string().min(1).default("gpt-4o-mini"),
    ANTHROPIC_API_KEY: z.string().optional().default(""),
    ANTHROPIC_MODEL: z.string().min(1).default("claude-sonnet-4-5"),
    DEFAULT_REPOSITORY: z.string().optional().default(""),
    PLAN_CONFIDENCE_THRESHOLD: z.coerce.number().min(0).max(1).default(0.6),
    CODING_AGENT: z.enum(["claude"]).default("claude"),
    CLAUDE_COMMAND: z.string().min(1).default("claude"),
    CLAUDE_EXTRA_ARGS: z.string().optional().default(""),
    CLAUDE_TIMEOUT_MS: z.coerce.number().int().positive().default(1_800_000),
    WORKTREE_ROOT: z.string().optional().default(""),
    SCHEDULER_INTERVAL_MS: z.coerce.number().int().positive().default(5000),
    SCHEDULER_ENABLED: z.string().optional().default("true"),
    PROJECTS_CONFIG: z.string().min(1).default("config/projects.json"),
  })
  .superRefine((env, ctx) => {
    const selected = readPlannerProvider(env);
    if (selected.invalid) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [selected.source ?? "PLANNER_PROVIDER"],
        message: "must be openai or anthropic",
      });
      return;
    }
    if (selected.provider === "openai" && env.OPENAI_API_KEY.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["OPENAI_API_KEY"],
        message: "OPENAI_API_KEY is required when PLANNER_PROVIDER=openai",
      });
    }
    if (selected.provider === "anthropic" && env.ANTHROPIC_API_KEY.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["ANTHROPIC_API_KEY"],
        message: "ANTHROPIC_API_KEY is required when PLANNER_PROVIDER=anthropic",
      });
    }
  });

export interface AppConfig {
  port: number;
  logLevel: string;
  slackBotToken: string;
  slackAppToken: string;
  slackSigningSecret: string;
  slackChannelIds: string[];
  notionToken: string;
  notionTaskDatabaseId: string;
  plannerProvider: PlannerProvider | null;
  openaiApiKey: string;
  openaiModel: string;
  anthropicApiKey: string;
  anthropicModel: string;
  defaultRepository: string;
  planConfidenceThreshold: number;
  codingAgent: "claude";
  claudeCommand: string;
  claudeExtraArgs: string;
  claudeTimeoutMs: number;
  worktreeRoot: string;
  schedulerIntervalMs: number;
  schedulerEnabled: boolean;
  projectsConfig: string;
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

export function formatConfigError(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("\n");
}

export function formatEnvError(error: z.ZodError): string {
  const missing: string[] = [];
  const other: string[] = [];
  for (const issue of error.issues) {
    const name = issue.path.join(".") || "(root)";
    if (isMissingEnvValue(issue)) {
      missing.push(name);
    } else {
      other.push(`${name}: ${issue.message}`);
    }
  }
  const lines: string[] = [];
  if (missing.length > 0) {
    lines.push("Missing required environment variables:");
    lines.push(...missing.map((name) => `- ${name}`));
  }
  lines.push(...other);
  return lines.join("\n");
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    throw new ConfigError(formatEnvError(parsed.error));
  }
  const value = parsed.data;
  const planner = readPlannerProvider(value);
  return {
    port: value.PORT,
    logLevel: value.LOG_LEVEL,
    slackBotToken: value.SLACK_BOT_TOKEN,
    slackAppToken: value.SLACK_APP_TOKEN,
    slackSigningSecret: value.SLACK_SIGNING_SECRET,
    slackChannelIds: value.SLACK_CHANNEL_IDS.split(",")
      .map((id) => id.trim())
      .filter((id) => id.length > 0),
    notionToken: value.NOTION_TOKEN,
    notionTaskDatabaseId: value.NOTION_TASK_DATABASE_ID,
    plannerProvider: planner.provider,
    openaiApiKey: value.OPENAI_API_KEY,
    openaiModel: value.OPENAI_MODEL,
    anthropicApiKey: value.ANTHROPIC_API_KEY,
    anthropicModel: value.ANTHROPIC_MODEL,
    defaultRepository: value.DEFAULT_REPOSITORY,
    planConfidenceThreshold: value.PLAN_CONFIDENCE_THRESHOLD,
    codingAgent: value.CODING_AGENT,
    claudeCommand: value.CLAUDE_COMMAND,
    claudeExtraArgs: value.CLAUDE_EXTRA_ARGS,
    claudeTimeoutMs: value.CLAUDE_TIMEOUT_MS,
    worktreeRoot: value.WORKTREE_ROOT,
    schedulerIntervalMs: value.SCHEDULER_INTERVAL_MS,
    schedulerEnabled: value.SCHEDULER_ENABLED !== "false",
    projectsConfig: value.PROJECTS_CONFIG,
  };
}

function readPlannerProvider(env: { PLANNER_PROVIDER: string; LLM_PROVIDER: string }): {
  provider: PlannerProvider | null;
  invalid: boolean;
  source: "PLANNER_PROVIDER" | "LLM_PROVIDER" | null;
} {
  const planner = env.PLANNER_PROVIDER.trim();
  const legacy = env.LLM_PROVIDER.trim();
  const source = planner.length > 0 ? "PLANNER_PROVIDER" : legacy.length > 0 ? "LLM_PROVIDER" : null;
  const raw = source === "PLANNER_PROVIDER" ? planner : source === "LLM_PROVIDER" ? legacy : "";
  if (raw.length === 0) {
    return { provider: null, invalid: false, source: null };
  }
  if ((PLANNER_PROVIDERS as readonly string[]).includes(raw)) {
    return { provider: raw as PlannerProvider, invalid: false, source };
  }
  return { provider: null, invalid: true, source };
}

function isMissingEnvValue(issue: z.ZodIssue): boolean {
  if (issue.code === "invalid_type" && issue.received === "undefined") {
    return true;
  }
  return issue.code === "too_small" && issue.type === "string";
}
