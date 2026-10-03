import type { AppLogger } from "../utils/logger.js";
import { PlanningError } from "../utils/errors.js";
import type { LlmClient } from "../llm/llm.client.js";
import { DEVELOPMENT_PLAN_SCHEMA_NAME, developmentPlanJsonSchema } from "./plan.schema.js";
import {
  PLANNER_SYSTEM_PROMPT,
  buildPlannerUserPrompt,
  developmentPlanSchema,
  type DevelopmentPlan,
  type PlannerProjectContext,
} from "./planner.prompt.js";

export interface Planner {
  plan(requestText: string, project?: PlannerProjectContext): Promise<DevelopmentPlan>;
}

export class PlannerService implements Planner {
  constructor(
    private readonly llm: LlmClient,
    private readonly logger: AppLogger,
    private readonly defaultRepository: string,
  ) {}

  async plan(requestText: string, project?: PlannerProjectContext): Promise<DevelopmentPlan> {
    this.logger.info({ event: "plan.started", status: "PLANNING" }, "planning started");
    const raw = await this.llm.completeStructured({
      system: PLANNER_SYSTEM_PROMPT,
      user: buildPlannerUserPrompt(requestText, project ? "" : this.defaultRepository, project),
      schemaName: DEVELOPMENT_PLAN_SCHEMA_NAME,
      schema: developmentPlanJsonSchema,
    });
    const parsed = developmentPlanSchema.safeParse(raw);
    if (!parsed.success) {
      this.logger.error(
        { event: "plan.invalid", status: "FAILED", error: { name: "PlanningError", message: "schema mismatch" } },
        "planning response rejected",
      );
      throw new PlanningError("LLM response did not match the development plan schema");
    }
    this.logger.info(
      {
        event: "plan.completed",
        status: parsed.data.needsHuman ? "NEEDS_HUMAN" : "READY",
      },
      "planning completed",
    );
    return parsed.data;
  }
}
