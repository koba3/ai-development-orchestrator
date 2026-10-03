import { z } from "zod";

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
    LLM_PROVIDER: z.enum(["openai", "anthropic"]),
    OPENAI_API_KEY: z.string().optional().default(""),
    OPENAI_MODEL: z.string().min(1).default("gpt-4o-mini"),
    ANTHROPIC_API_KEY: z.string().optional().default(""),
    ANTHROPIC_MODEL: z.string().min(1).default("claude-sonnet-4-5"),
    DEFAULT_REPOSITORY: z.string().optional().default(""),
    PLAN_CONFIDENCE_THRESHOLD: z.coerce.number().min(0).max(1).default(0.6),
  })
  .superRefine((env, ctx) => {
    if (env.LLM_PROVIDER === "openai" && env.OPENAI_API_KEY.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["OPENAI_API_KEY"],
        message: "OPENAI_API_KEY is required when LLM_PROVIDER=openai",
      });
    }
    if (env.LLM_PROVIDER === "anthropic" && env.ANTHROPIC_API_KEY.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["ANTHROPIC_API_KEY"],
        message: "ANTHROPIC_API_KEY is required when LLM_PROVIDER=anthropic",
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
  llmProvider: "openai" | "anthropic";
  openaiApiKey: string;
  openaiModel: string;
  anthropicApiKey: string;
  anthropicModel: string;
  defaultRepository: string;
  planConfidenceThreshold: number;
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

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    throw new ConfigError(formatConfigError(parsed.error));
  }
  const value = parsed.data;
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
    llmProvider: value.LLM_PROVIDER,
    openaiApiKey: value.OPENAI_API_KEY,
    openaiModel: value.OPENAI_MODEL,
    anthropicApiKey: value.ANTHROPIC_API_KEY,
    anthropicModel: value.ANTHROPIC_MODEL,
    defaultRepository: value.DEFAULT_REPOSITORY,
    planConfidenceThreshold: value.PLAN_CONFIDENCE_THRESHOLD,
  };
}
