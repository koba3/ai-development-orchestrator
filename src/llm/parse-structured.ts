import { PlanningError } from "../utils/errors.js";

export function parseJsonContent(content: string | null | undefined): unknown {
  if (!content) {
    throw new PlanningError("LLM returned empty content");
  }
  try {
    return JSON.parse(content) as unknown;
  } catch (error) {
    throw new PlanningError("LLM returned invalid JSON", { cause: error });
  }
}

export function parseToolInput(
  content: ReadonlyArray<{ type: string; name?: string; input?: unknown }>,
  toolName: string,
): unknown {
  const block = content.find((item) => item.type === "tool_use" && item.name === toolName);
  if (!block || block.input === undefined) {
    throw new PlanningError("LLM did not return a structured plan");
  }
  return block.input;
}
