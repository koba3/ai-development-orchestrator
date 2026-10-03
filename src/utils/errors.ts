export class PlanningError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "PlanningError";
  }
}

const SECRET_PATTERNS = [
  /sk-[a-zA-Z0-9_-]{10,}/g,
  /xox[baprs]-[a-zA-Z0-9-]{10,}/g,
  /secret_[a-zA-Z0-9]{10,}/g,
  /ghp_[a-zA-Z0-9]{10,}/g,
  /github_pat_[a-zA-Z0-9_]{10,}/g,
  /Bearer\s+\S+/gi,
];

export function sanitizeError(error: unknown): { name: string; message: string } {
  const name = error instanceof Error ? error.name : "Error";
  const raw = error instanceof Error ? error.message : "unknown error";
  let message = raw;
  for (const pattern of SECRET_PATTERNS) {
    message = message.replace(pattern, "[REDACTED]");
  }
  return { name, message };
}
