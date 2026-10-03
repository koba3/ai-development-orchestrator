export class UnknownAgentError extends Error {
  constructor(agent: string) {
    super(`unknown agent: ${agent}`);
    this.name = "UnknownAgentError";
  }
}

export class UnsupportedAgentError extends Error {
  constructor(agent: string) {
    super(`unsupported agent: ${agent}`);
    this.name = "UnsupportedAgentError";
  }
}

export class AgentExecutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentExecutionError";
  }
}
