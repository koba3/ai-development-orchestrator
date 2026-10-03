import { describe, expect, it } from "vitest";
import pino from "pino";
import { PlanningError } from "../src/utils/errors.js";
import { PlannerService } from "../src/orchestrator/planner.service.js";
import type { LlmClient } from "../src/llm/llm.client.js";
import { parseJsonContent, parseToolInput } from "../src/llm/parse-structured.js";

const logger = pino({ level: "silent" });

describe("PlannerService", () => {
  it("returns the structured plan and ignores extra prose by validating JSON only", async () => {
    const llm: LlmClient = {
      async completeStructured() {
        return {
          needsHuman: false,
          summary: "顧客一覧に管理者限定のCSV出力機能を追加",
          humanQuestion: null,
          confidence: 0.91,
          tasks: [
            {
              title: "CSV出力APIを実装",
              description: "管理者だけが顧客CSVをダウンロードできるAPI",
              agentType: "backend",
              priority: "normal",
              repository: null,
            },
          ],
        };
      },
    };
    const planner = new PlannerService(llm, logger, "/tmp/questoon");
    const plan = await planner.plan("Questoonに顧客CSV出力を追加して");
    expect(plan.tasks[0]?.agentType).toBe("backend");
    expect(plan.summary).toContain("CSV");
  });

  it("rejects a plan that does not match the schema", async () => {
    const llm: LlmClient = {
      async completeStructured() {
        return { summary: "だけ" };
      },
    };
    const planner = new PlannerService(llm, logger, "");
    await expect(planner.plan("依頼")).rejects.toBeInstanceOf(PlanningError);
  });
});

describe("structured parsers", () => {
  it("parses JSON content and tool input", () => {
    expect(parseJsonContent('{"ok":true}')).toEqual({ ok: true });
    expect(parseToolInput([{ type: "tool_use", name: "development_plan", input: { ok: true } }], "development_plan")).toEqual({
      ok: true,
    });
  });

  it("fails closed when the model returns prose", () => {
    expect(() => parseJsonContent("sure, here you go")).toThrow(PlanningError);
    expect(() => parseToolInput([{ type: "text" }], "development_plan")).toThrow(PlanningError);
  });
});
