import type { AppConfig } from "./config/index.js";
import { createLlmClient } from "./llm/llm.factory.js";
import { NotionService } from "./notion/notion.service.js";
import { NotificationService } from "./notifications/notification.service.js";
import { OrchestratorService } from "./orchestrator/orchestrator.service.js";
import { PlannerService } from "./orchestrator/planner.service.js";
import { SlackListener } from "./slack/slack.listener.js";
import { SlackService } from "./slack/slack.service.js";
import { TaskService } from "./tasks/task.service.js";
import { createLogger, type AppLogger } from "./utils/logger.js";

export interface Application {
  orchestrator: OrchestratorService;
  listener: SlackListener;
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
  const orchestrator = new OrchestratorService(
    planner,
    tasks,
    notifier,
    logger,
    config.planConfidenceThreshold,
  );
  const listener = new SlackListener(config, orchestrator, slack, logger);
  return { orchestrator, listener, logger };
}
