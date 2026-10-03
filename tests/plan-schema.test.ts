import { describe, expect, it } from "vitest";
import { developmentPlanJsonSchema } from "../src/orchestrator/plan.schema.js";
import { PLANNER_SYSTEM_PROMPT } from "../src/orchestrator/planner.prompt.js";

function assertStrictObject(schema: Record<string, unknown>): void {
  expect(schema.type).toBe("object");
  expect(schema.additionalProperties).toBe(false);
  const properties = schema.properties as Record<string, unknown>;
  const required = schema.required as string[];
  expect(required.sort()).toEqual(Object.keys(properties).sort());
}

describe("developmentPlanJsonSchema", () => {
  it("is a closed object schema the model cannot extend", () => {
    assertStrictObject(developmentPlanJsonSchema as unknown as Record<string, unknown>);
    const tasks = (developmentPlanJsonSchema.properties.tasks.items) as unknown as Record<string, unknown>;
    assertStrictObject(tasks);
  });
});

describe("PLANNER_SYSTEM_PROMPT", () => {
  it("includes the human gates that TypeScript must not leave to free text", () => {
    for (const phrase of [
      "production DB",
      "DB migration",
      "production deploy",
      "認証",
      "外部サービス",
      "課金",
      "secrets",
      "breaking change",
      "曖昧",
    ]) {
      expect(PLANNER_SYSTEM_PROMPT).toContain(phrase);
    }
  });
});
