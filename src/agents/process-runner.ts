import type { CommandRequest, CommandResult } from "../utils/command.js";

export type CommandRunner = (request: CommandRequest) => Promise<CommandResult>;

const SECRET_ENV_KEYS = [
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "NOTION_TOKEN",
  "SLACK_BOT_TOKEN",
  "SLACK_APP_TOKEN",
  "SLACK_SIGNING_SECRET",
  "GITHUB_TOKEN",
  "GH_TOKEN",
];

export function agentEnvironment(source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env = { ...source };
  for (const key of SECRET_ENV_KEYS) {
    delete env[key];
  }
  return env;
}

export function splitCommandArgs(value: string): string[] {
  const args: string[] = [];
  for (const match of value.matchAll(/"([^"]*)"|(\S+)/g)) {
    const token = match[1] ?? match[2];
    if (token) {
      args.push(token);
    }
  }
  return args;
}
