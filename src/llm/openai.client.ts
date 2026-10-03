import OpenAI from "openai";
import type { AppConfig } from "../config/index.js";
import type { LlmClient, StructuredCompletionInput } from "./llm.client.js";
import { parseJsonContent } from "./parse-structured.js";

export class OpenAiClient implements LlmClient {
  private readonly client: OpenAI;

  constructor(private readonly config: Pick<AppConfig, "openaiApiKey" | "openaiModel">) {
    this.client = new OpenAI({ apiKey: config.openaiApiKey });
  }

  async completeStructured(input: StructuredCompletionInput): Promise<unknown> {
    const completion = await this.client.chat.completions.create({
      model: this.config.openaiModel,
      messages: [
        { role: "system", content: input.system },
        { role: "user", content: input.user },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: input.schemaName,
          strict: true,
          schema: input.schema as { [key: string]: unknown },
        },
      },
    });
    return parseJsonContent(completion.choices[0]?.message.content);
  }
}
