import { describe, expect, it } from "vitest";
import { decideApproval, detectHumanGate } from "../src/planning/approval.service.js";
import type { DevelopmentPlan } from "../src/planning/planner.prompt.js";

function plan(overrides: Partial<DevelopmentPlan> = {}): DevelopmentPlan {
  return {
    needsHuman: false,
    summary: "顧客一覧にCSV出力を追加",
    humanQuestion: null,
    confidence: 0.9,
    tasks: [
      {
        title: "CSV出力APIを実装",
        description: "管理者だけが使える",
        agentType: "backend",
        priority: "normal",
        repository: null,
      },
    ],
    ...overrides,
  };
}

describe("decideApproval", () => {
  it("marks a confident plan READY", () => {
    expect(decideApproval(plan(), 0.6)).toEqual({
      status: "READY",
      needsHuman: false,
      humanQuestion: "",
    });
  });

  it("keeps the model question when the plan already needs a human", () => {
    const decision = decideApproval(
      plan({ needsHuman: true, humanQuestion: "本番DBを変更してよいですか？", confidence: 0.2 }),
      0.6,
    );
    expect(decision.status).toBe("NEEDS_HUMAN");
    expect(decision.humanQuestion).toContain("本番DBを変更してよいですか？");
  });

  it("asks for confirmation when confidence is below the threshold", () => {
    const decision = decideApproval(plan({ confidence: 0.4 }), 0.6);
    expect(decision.status).toBe("NEEDS_HUMAN");
    expect(decision.humanQuestion).toContain("確信度が低い");
  });

  it("forces human review when a secret was removed from the request", () => {
    const decision = decideApproval(plan(), 0.6, { forceHumanReason: "秘密情報がありました" });
    expect(decision.status).toBe("NEEDS_HUMAN");
    expect(decision.humanQuestion).toContain("秘密情報がありました");
  });
});

describe("detectHumanGate", () => {
  it("leaves an ordinary feature request to the model", () => {
    expect(detectHumanGate("Questoonに顧客CSV出力を追加して。管理者だけ使えるように")).toBeNull();
  });

  it("holds migration, production deploy, billing, and secret changes", () => {
    expect(detectHumanGate("顧客テーブルに migration を追加して")).toContain("migration");
    expect(detectHumanGate("本番にデプロイして")).toContain("deploy");
    expect(detectHumanGate("この操作は課金が発生する")).toContain("課金");
    expect(detectHumanGate("シークレットをローテーションして")).toContain("secrets");
  });
});
