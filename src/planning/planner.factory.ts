import type { AppConfig } from "../config/index.js";
import { createLlmClient } from "../llm/llm.factory.js";
import { PlanningError } from "../utils/errors.js";
import type { AppLogger } from "../utils/logger.js";
import type { Planner } from "./planner.service.js";
import { PlannerService } from "./planner.service.js";

export function createPlanner(config: AppConfig, logger: AppLogger): Planner {
  if (!config.plannerProvider) {
    return {
      async plan() {
        throw new PlanningError(
          "PLANNER_PROVIDER is not set. Set PLANNER_PROVIDER=openai or PLANNER_PROVIDER=anthropic to plan tasks.",
        );
      },
    };
  }
  return new PlannerService(createLlmClient(config), logger, config.defaultRepository);
}
