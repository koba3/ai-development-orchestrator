import type { AppConfig } from "./config/index.js";
import { createCodingAgent } from "./agents/agent.factory.js";
import { GitService } from "./git/git.service.js";
import { WorktreeService } from "./git/worktree.service.js";
import { createLlmClient } from "./llm/llm.factory.js";
import { NotionService } from "./notion/notion.service.js";
import { NotificationService } from "./notifications/notification.service.js";
import { OrchestratorService } from "./orchestrator/orchestrator.service.js";
import { PlannerService } from "./orchestrator/planner.service.js";
import { loadProjectCatalog } from "./routing/project-catalog.js";
import { ProjectRouter } from "./routing/project-router.js";
import { SchedulerService } from "./scheduler/scheduler.service.js";
import { SlackListener } from "./slack/slack.listener.js";
import { SlackService } from "./slack/slack.service.js";
import { TaskService } from "./tasks/task.service.js";
import { createLogger, type AppLogger } from "./utils/logger.js";

export interface Application {
  orchestrator: OrchestratorService;
  listener: SlackListener;
  scheduler: SchedulerService;
  logger: AppLogger;
}

export function createApplication(config: AppConfig): Application {
  const logger = createLogger({ level: config.logLevel });
  const slack = new SlackService(config.slackBotToken, logger);
  const notifier = new NotificationService(slack, logger);
  const planner = new PlannerService(createLlmClient(config), logger, config.defaultRepository);
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
  const router = new ProjectRouter(loaded.catalog);
  const orchestrator = new OrchestratorService(
    planner,
    tasks,
    notifier,
    logger,
    config.planConfidenceThreshold,
    router,
  );
  const listener = new SlackListener(config, orchestrator, slack, logger);
  const scheduler = new SchedulerService(
    tasks,
    new WorktreeService(config.worktreeRoot),
    new GitService(),
    createCodingAgent(config),
    logger,
    {
      enabled: config.schedulerEnabled,
      intervalMs: config.schedulerIntervalMs,
      worktreeRoot: config.worktreeRoot,
    },
    router,
  );
  return { orchestrator, listener, scheduler, logger };
}
