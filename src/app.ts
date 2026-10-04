import type { IncomingMessage, ServerResponse } from "node:http";
import type { AppConfig } from "./config/index.js";
import { handleConfigHttp } from "./config/config-http.js";
import { openRuntimeConfiguration, type RuntimeConfiguration } from "./config/runtime-config.js";
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
import { ProjectRouter } from "./routing/project-router.js";
import { SchedulerService } from "./scheduler/scheduler.service.js";
import { SlackConnectionManager } from "./slack/slack-connection-manager.js";
import { SlackListener } from "./slack/slack.listener.js";
import { TaskService } from "./tasks/task.service.js";
import { createLogger, type AppLogger } from "./utils/logger.js";

export interface Application {
  intake: IntakeService;
  listener: SlackListener;
  scheduler: SchedulerService;
  logger: AppLogger;
  runtime: RuntimeConfiguration;
  handleHttp(request: IncomingMessage, response: ServerResponse): Promise<boolean>;
}

export function createApplication(config: AppConfig): Application {
  const logger = createLogger({ level: config.logLevel });
  const runtime = openRuntimeConfiguration({
    storePath: config.configStorePath,
    encryptionKey: config.encryptionKey,
    legacySlackPath: config.slackConnectionsConfig,
    legacyProjectsPath: config.projectsConfig,
    logger,
  });
  const connections = runtime.slackConnections();
  const slack = new SlackConnectionManager(connections, logger);
  const notifier = new NotificationService(slack, logger);
  const planner = createPlanner(config, logger);
  const tasks = new TaskService(new NotionService(config, logger), logger, {
    defaultRepository: config.defaultRepository,
  });
  const catalog = runtime.projectCatalog();
  if (Object.keys(catalog.projects).length === 0) {
    logger.warn(
      { event: "projects.config.missing", status: "NEEDS_HUMAN" },
      "runtime project catalog is empty; Slack requests will ask for a project",
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
  const router = new ProjectRouter(catalog);
  const orchestration = new Orchestration(catalog, router);
  const intake = new IntakeService(
    planner,
    tasks,
    notifier,
    logger,
    config.planConfidenceThreshold,
    orchestration,
  );
  const listener = new SlackListener(connections, intake, slack, logger);
  const scheduler = new SchedulerService(
    tasks,
    new WorktreeService(config.worktreeRoot),
    new GitService(),
    createAgentRuntime({ codingAgent: config.codingAgent, timeoutMs: config.claudeTimeoutMs, commands }),
    logger,
    {
      enabled: config.schedulerEnabled,
      intervalMs: config.schedulerIntervalMs,
      worktreeRoot: config.worktreeRoot,
    },
    orchestration,
  );
  let slackReload: Promise<void> = Promise.resolve();
  return {
    intake,
    listener,
    scheduler,
    logger,
    runtime,
    handleHttp(request, response) {
      return handleConfigHttp(request, response, {
        adminToken: config.adminToken,
        runtime,
        logger,
        reloadSlack() {
          const run = slackReload.then(async () => {
            const next = runtime.slackConnections();
            slack.replace(next);
            await listener.apply(next);
          });
          slackReload = run.then(() => undefined, () => undefined);
          return run;
        },
        reloadProjects() {
          const next = runtime.projectCatalog();
          router.replace(next);
          orchestration.replace(next);
        },
      });
    },
  };
}
