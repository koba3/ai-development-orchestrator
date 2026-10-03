import type { AppConfig } from "../config/index.js";
import { AnthropicClient } from "./anthropic.client.js";
import type { LlmClient } from "./llm.client.js";
import { OpenAiClient } from "./openai.client.js";

export function createLlmClient(config: AppConfig): LlmClient {
  if (config.plannerProvider === "openai") {
    return new OpenAiClient(config);
  }
  if (config.plannerProvider === "anthropic") {
    return new AnthropicClient(config);
  }
  throw new Error("PLANNER_PROVIDER is not set");
}
