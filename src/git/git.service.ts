import type { AgentType } from "../tasks/task.types.js";
import { runCommand, type CommandRequest, type CommandResult } from "../utils/command.js";

export type CommitType = "feat" | "fix" | "refactor" | "test" | "docs" | "chore";

export interface CommitResult {
  committed: boolean;
  sha: string;
  subject: string;
  diffStat: string;
}

export type CommandRunner = (request: CommandRequest) => Promise<CommandResult>;

const SECRET_PATH =
  /(^|\/)\.env($|\.)|(^|\/)(id_rsa|id_ed25519)$|\.pem$|\.p12$|(^|\/)[^/]+\.key$|(^|\/)credentials\.json$/i;

const TITLE_TYPES: Array<{ type: CommitType; pattern: RegExp }> = [
  { type: "test", pattern: /テスト|\btests?\b/i },
  { type: "fix", pattern: /修正|バグ|\bfix\b|\bbug\b/i },
  { type: "refactor", pattern: /リファクタ|\brefactor\b/i },
  { type: "docs", pattern: /readme|ドキュメント|文書|\bdocs?\b/i },
  { type: "chore", pattern: /雑務|\bchore\b/i },
];

export function commitTypeFor(input: { title: string; agentType: AgentType }): CommitType {
  if (input.agentType === "test") {
    return "test";
  }
  for (const rule of TITLE_TYPES) {
    if (rule.pattern.test(input.title)) {
      return rule.type;
    }
  }
  return "feat";
}

export function buildCommitMessage(input: { taskId: string; title: string; agentType: AgentType }): string {
  const type = commitTypeFor(input);
  const subject = input.title.replace(/\s+/g, " ").trim().slice(0, 72) || "update repository";
  return `${type}(${input.taskId}): ${subject}`;
}

export function parsePorcelain(status: string): string[] {
  return status
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0)
    .map((line) => {
      const path = line.slice(3).trim();
      return path.split(" -> ").at(-1) ?? path;
    });
}

export function findSecretPaths(paths: string[]): string[] {
  return paths.filter((filePath) => SECRET_PATH.test(filePath));
}

export class GitService {
  constructor(
    private readonly run: CommandRunner = runCommand,
    private readonly env: NodeJS.ProcessEnv = process.env,
  ) {}

  async commitIfNeeded(worktree: string, message: string): Promise<CommitResult> {
    const status = await this.git(worktree, ["status", "--porcelain"]);
    const paths = parsePorcelain(status.stdout);
    if (paths.length === 0) {
      return { committed: false, sha: "", subject: message, diffStat: "" };
    }
    const secrets = findSecretPaths(paths);
    if (secrets.length > 0) {
      throw new Error(`refusing to commit secret files: ${secrets.join(", ")}`);
    }
    const diff = await this.git(worktree, ["diff", "--stat"]);
    await this.git(worktree, ["add", "-A"]);
    await this.git(worktree, ["commit", "-m", message]);
    const sha = await this.git(worktree, ["rev-parse", "--short", "HEAD"]);
    return {
      committed: true,
      sha: sha.stdout.trim(),
      subject: message,
      diffStat: diff.stdout.trim(),
    };
  }

  private async git(worktree: string, args: string[]): Promise<CommandResult> {
    const result = await this.run({
      command: "git",
      args: ["-C", worktree, ...args],
      cwd: worktree,
      env: { ...this.env, GIT_TERMINAL_PROMPT: "0" },
    });
    if (result.exitCode !== 0) {
      const detail = result.stderr.trim() || result.stdout.trim() || `git ${args[0] ?? "command"} failed`;
      throw new Error(detail);
    }
    return result;
  }
}
