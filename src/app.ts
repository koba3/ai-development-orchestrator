import type { AppConfig } from "./config/index.js";
import { applyCommandOverrides, loadAgentConfig } from "./agents/agent-config.js";
import { splitCommandArgs } from "./agents/process-runner.js";
import { createAgentRuntime } from "./agents/agent-runtime.js";
import { GitService } from "./git/git.service.js";
import { WorktreeService } from "./git/worktree.service.js";
import { createPlanner } from "./planning/planner.factory.js";
import { NotionService } from "./notion/notion.service.js";
import { NotificationService } from "./notifications/notification.service.js";
import { IntakeService } from "./intake/intake.service.js";
import { Orchestration } from "./orchestration/orchestration.js";
import { loadProjectCatalog } from "./routing/project-catalog.js";
import { ProjectRouter } from "./routing/project-router.js";
import { SchedulerService } from "./scheduler/scheduler.service.js";
import { SlackListener } from "./slack/slack.listener.js";
import { SlackService } from "./slack/slack.service.js";
import { TaskService } from "./tasks/task.service.js";
import { createLogger, type AppLogger } from "./utils/logger.js";

export interface Application {
  intake: IntakeService;
  listener: SlackListener;
  scheduler: SchedulerService;
  logger: AppLogger;
}

export function createApplication(config: AppConfig): Application {
  const logger = createLogger({ level: config.logLevel });
  const slack = new SlackService(config.slackBotToken, logger);
  const notifier = new NotificationService(slack, logger);
  const planner = createPlanner(config, logger);
  const tasks = new TaskService(new NotionService(config, logger), logger, {
    defaultRepository: config.defaultRepository,
  });
  const loaded = loadProjectCatalog(config.projectsConfig);
  if (loaded.missing) {
    logger.warn(
      { event: "projects.config.missing", status: "NEEDS_HUMAN" },
      "projects config is missing; Slack requests will ask for a project",
    );
  }
  const agents = loadAgentConfig(config.agentsConfig);
  if (agents.missing) {
    logger.warn(
      { event: "agents.config.missing", status: "READY" },
      "agents config is missing; using the built-in claude, codex, and cursor commands",
    );
  }
  const commands = applyCommandOverrides(agents.commands, {
    claude: config.claudeCommand,
    codex: config.codexCommand,
    cursor: config.cursorCommand,
  });
  if (config.claudeExtraArgs.trim().length > 0) {
    commands.claude = {
      ...commands.claude,
      extraArgs: [...commands.claude.extraArgs, ...splitCommandArgs(config.claudeExtraArgs)],
    };
  }
  const orchestration = new Orchestration(loaded.catalog, new ProjectRouter(loaded.catalog));
  const intake = new IntakeService(
    planner,
    tasks,
    notifier,
    logger,
    config.planConfidenceThreshold,
    orchestration,
  );
  const listener = new SlackListener(config, intake, slack, logger);
  const scheduler = new SchedulerService(
    tasks,
    new WorktreeService(config.worktreeRoot),
    new GitService(),
    createAgentRuntime({ codingAgent: config.codingAgent, claudeTimeoutMs: config.claudeTimeoutMs, commands }),
    logger,
    {
      enabled: config.schedulerEnabled,
      intervalMs: config.schedulerIntervalMs,
      worktreeRoot: config.worktreeRoot,
    },
    orchestration,
  );
  return { intake, listener, scheduler, logger };
}
