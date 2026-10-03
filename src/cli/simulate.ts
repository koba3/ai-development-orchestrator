import "dotenv/config";
import { createPlanner } from "../planning/planner.factory.js";
import { NotionService } from "../notion/notion.service.js";
import type {
  Notifier,
  PlanningFailedNotice,
  RouteRejectedNotice,
  TasksCreatedNotice,
} from "../notifications/notification.service.js";
import { formatPlanningFailedMessage, formatTasksCreatedMessage } from "../notifications/notification.service.js";
import { IntakeService } from "../intake/intake.service.js";
import { Orchestration } from "../orchestration/orchestration.js";
import { loadProjectCatalog } from "../routing/project-catalog.js";
import { ProjectRouter } from "../routing/project-router.js";
import { toOrchestrationInput } from "../slack/slack-input.adapter.js";
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
  const intake = new IntakeService(
    createPlanner(config, logger),
    new TaskService(new NotionService(config, logger), logger, {
      defaultRepository: config.defaultRepository,
    }),
    new ConsoleNotifier(),
    logger,
    config.planConfidenceThreshold,
    new Orchestration(loaded.catalog, new ProjectRouter(loaded.catalog)),
  );

  await intake.handle(toOrchestrationInput({
    workspaceId: process.env.SIMULATE_WORKSPACE_ID ?? "",
    channel: process.env.SIMULATE_CHANNEL_ID ?? "simulate",
    user: "simulate",
    text: request,
    messageTs: `simulate-${Date.now()}`,
    threadTs: "simulate",
  }));
}

void main();
