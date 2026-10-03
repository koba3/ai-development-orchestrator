import pino, { type DestinationStream, type Logger } from "pino";

export type AppLogger = Logger;

export function createLogger(options?: {
  level?: string;
  destination?: DestinationStream;
}): AppLogger {
  const loggerOptions = {
    level: options?.level ?? "info",
    base: undefined,
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: {
      level(label: string) {
        return { level: label };
      },
    },
    redact: {
      paths: [
        "token",
        "apiKey",
        "authorization",
        "slackBotToken",
        "slackAppToken",
        "notionToken",
        "openaiApiKey",
        "anthropicApiKey",
        "*.token",
        "*.apiKey",
        "*.authorization",
      ],
      censor: "[REDACTED]",
    },
  };
  if (options?.destination) {
    return pino(loggerOptions, options.destination);
  }
  return pino(loggerOptions);
}
