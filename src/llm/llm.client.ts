export interface StructuredCompletionInput {
  system: string;
  user: string;
  schemaName: string;
  schema: object;
}

export interface LlmClient {
  completeStructured(input: StructuredCompletionInput): Promise<unknown>;
}
