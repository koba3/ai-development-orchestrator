import Anthropic from "@anthropic-ai/sdk";
import type { AppConfig } from "../config/index.js";
import { DEVELOPMENT_PLAN_SCHEMA_NAME } from "../planning/plan.schema.js";
import type { LlmClient, StructuredCompletionInput } from "./llm.client.js";
import { parseToolInput } from "./parse-structured.js";

export class AnthropicClient implements LlmClient {
  private readonly client: Anthropic;

  constructor(private readonly config: Pick<AppConfig, "anthropicApiKey" | "anthropicModel">) {
    this.client = new Anthropic({ apiKey: config.anthropicApiKey });
  }

  async completeStructured(input: StructuredCompletionInput): Promise<unknown> {
    const message = await this.client.messages.create({
      model: this.config.anthropicModel,
      max_tokens: 4096,
      system: input.system,
      tool_choice: { type: "tool", name: DEVELOPMENT_PLAN_SCHEMA_NAME },
      tools: [
        {
          name: DEVELOPMENT_PLAN_SCHEMA_NAME,
          description: "開発依頼を構造化されたタスク計画として提出する",
          input_schema: input.schema as Anthropic.Tool.InputSchema,
        },
      ],
      messages: [{ role: "user", content: input.user }],
    });
    return parseToolInput(message.content, DEVELOPMENT_PLAN_SCHEMA_NAME);
  }
}
