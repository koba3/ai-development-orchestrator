import { AGENT_TYPES, PRIORITIES } from "../tasks/task.types.js";

export const DEVELOPMENT_PLAN_SCHEMA_NAME = "development_plan";

export const developmentPlanJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    needsHuman: {
      type: "boolean",
      description: "人間の確認なしに実装へ進めてはいけないとき true",
    },
    summary: {
      type: "string",
      description: "依頼の要約。日本語",
    },
    humanQuestion: {
      type: ["string", "null"],
      description: "人間に確認する質問。不要なら null",
    },
    confidence: {
      type: "number",
      description: "この分解で実装方針を決められる確信度。0 から 1",
    },
    tasks: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          title: { type: "string", description: "タスク名。日本語" },
          description: {
            type: "string",
            description: "担当エージェントが実装できる受け入れ条件。日本語。秘密情報は書かない",
          },
          agentType: {
            type: "string",
            enum: [...AGENT_TYPES],
            description: "担当エージェント",
          },
          priority: {
            type: "string",
            enum: [...PRIORITIES],
          },
          repository: {
            type: ["string", "null"],
            description: "パスまたは owner/repo。不明なら null",
          },
        },
        required: ["title", "description", "agentType", "priority", "repository"],
      },
    },
  },
  required: ["needsHuman", "summary", "humanQuestion", "confidence", "tasks"],
} as const;
