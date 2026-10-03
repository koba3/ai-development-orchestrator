import type { AppConfig } from "../config/index.js";
import { AnthropicClient } from "./anthropic.client.js";
import type { LlmClient } from "./llm.client.js";
import { OpenAiClient } from "./openai.client.js";

export function createLlmClient(config: AppConfig): LlmClient {
  if (config.llmProvider === "openai") {
    return new OpenAiClient(config);
  }
  return new AnthropicClient(config);
}
