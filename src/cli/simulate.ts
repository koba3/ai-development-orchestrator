import "dotenv/config";
import { createLlmClient } from "../llm/llm.factory.js";
import { NotionService } from "../notion/notion.service.js";
import type {
  Notifier,
  PlanningFailedNotice,
  RouteRejectedNotice,
  TasksCreatedNotice,
} from "../notifications/notification.service.js";
import { formatPlanningFailedMessage, formatTasksCreatedMessage } from "../notifications/notification.service.js";
import { OrchestratorService } from "../orchestrator/orchestrator.service.js";
import { PlannerService } from "../orchestrator/planner.service.js";
import { loadProjectCatalog } from "../routing/project-catalog.js";
import { ProjectRouter } from "../routing/project-router.js";
import { TaskService } from "../tasks/task.service.js";
import { ConfigError, loadConfig } from "../config/index.js";
import { createLogger } from "../utils/logger.js";

class ConsoleNotifier implements Notifier {
  async notifyTasksCreated(notice: TasksCreatedNotice): Promise<void> {
    process.stdout.write(`${formatTasksCreatedMessage(notice)}\n`);
  }

  async notifyPlanningFailed(_notice: PlanningFailedNotice): Promise<void> {
    process.stderr.write(`${formatPlanningFailedMessage()}\n`);
  }

  async notifyRouteRejected(notice: RouteRejectedNotice): Promise<void> {
    process.stdout.write(`${notice.text}\n`);
  }
}

async function main(): Promise<void> {
  const request = process.argv.slice(2).join(" ").trim();
  if (request.length === 0) {
    process.stderr.write("usage: npm run simulate -- \"依頼文\"\n");
    process.exitCode = 1;
    return;
  }

  let config: ReturnType<typeof loadConfig>;
  try {
    config = loadConfig();
  } catch (error) {
    const message = error instanceof ConfigError ? error.message : "configuration is invalid";
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
    return;
  }

  const logger = createLogger({ level: config.logLevel });
  const loaded = loadProjectCatalog(config.projectsConfig);
  const orchestrator = new OrchestratorService(
    new PlannerService(createLlmClient(config), logger, config.defaultRepository),
    new TaskService(new NotionService(config, logger), logger, {
      defaultRepository: config.defaultRepository,
    }),
    new ConsoleNotifier(),
    logger,
    config.planConfidenceThreshold,
    new ProjectRouter(loaded.catalog),
  );

  await orchestrator.handle({
    workspaceId: process.env.SIMULATE_WORKSPACE_ID ?? "",
    channel: process.env.SIMULATE_CHANNEL_ID ?? "simulate",
    user: "simulate",
    text: request,
    messageTs: `simulate-${Date.now()}`,
    threadTs: "simulate",
  });
}

void main();
