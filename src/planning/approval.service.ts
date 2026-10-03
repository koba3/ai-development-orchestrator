import type { TaskStatus } from "../tasks/task.types.js";
import type { DevelopmentPlan } from "./planner.prompt.js";

export interface ApprovalDecision {
  status: Extract<TaskStatus, "READY" | "NEEDS_HUMAN">;
  needsHuman: boolean;
  humanQuestion: string;
}

const LOW_CONFIDENCE_QUESTION =
  "要件の確信度が低いため、実装方針を確認させてください。この理解で進めてよいですか？";

const DEFAULT_HUMAN_QUESTION = "この依頼は人間の確認が必要です。続行してよいですか？";

const HUMAN_GATES: Array<{ pattern: RegExp; reason: string }> = [
  {
    pattern: /migrat(e|ion)|マイグレーション/i,
    reason: "DB migration が含まれるため、実行前に確認が必要です。",
  },
  {
    pattern: /本番\s*(db|データベース)|production\s+(db|database)/i,
    reason: "production DB の変更が含まれるため、確認が必要です。",
  },
  {
    pattern: /(本番|production).{0,16}(deploy|デプロイ|リリース)|(deploy|デプロイ).{0,16}(本番|production)/i,
    reason: "production deploy が含まれるため、確認が必要です。",
  },
  {
    pattern: /課金|billing|請求/i,
    reason: "課金が発生する操作の可能性があるため、確認が必要です。",
  },
  {
    pattern: /breaking change|破壊的変更/i,
    reason: "大規模な breaking change の可能性があるため、確認が必要です。",
  },
  {
    pattern: /契約(変更|更新|締結)|外部サービス.{0,12}契約/i,
    reason: "外部サービスの契約変更が含まれるため、確認が必要です。",
  },
  {
    pattern: /(secret|secrets|シークレット).{0,10}(変更|更新|ローテ|rotate)|secrets?\s*(change|rotate)/i,
    reason: "secrets の変更が含まれるため、確認が必要です。",
  },
];

export function detectHumanGate(text: string): string | null {
  const reasons = HUMAN_GATES.filter((gate) => gate.pattern.test(text)).map((gate) => gate.reason);
  return reasons.length > 0 ? reasons.join("\n") : null;
}

export function decideApproval(
  plan: DevelopmentPlan,
  threshold: number,
  options?: { forceHumanReason?: string },
): ApprovalDecision {
  const lowConfidence = plan.confidence < threshold;
  const forceHumanReason = options?.forceHumanReason?.trim() ?? "";
  const needsHuman = plan.needsHuman || lowConfidence || forceHumanReason.length > 0;
  if (!needsHuman) {
    return { status: "READY", needsHuman: false, humanQuestion: "" };
  }

  const parts: string[] = [];
  if (forceHumanReason.length > 0) {
    parts.push(forceHumanReason);
  }
  const modelQuestion = plan.humanQuestion?.trim() ?? "";
  if (modelQuestion.length > 0) {
    parts.push(modelQuestion);
  } else if (lowConfidence) {
    parts.push(`${LOW_CONFIDENCE_QUESTION}\n要約: ${plan.summary}`);
  } else if (parts.length === 0) {
    parts.push(DEFAULT_HUMAN_QUESTION);
  }

  return {
    status: "NEEDS_HUMAN",
    needsHuman: true,
    humanQuestion: parts.join("\n"),
  };
}
