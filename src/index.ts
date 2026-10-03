import "dotenv/config";
import { createApplication } from "./app.js";
import { ConfigError, loadConfig } from "./config/index.js";
import { startHealthServer } from "./health/health.server.js";
import { sanitizeError } from "./utils/errors.js";
import { createLogger } from "./utils/logger.js";

async function main(): Promise<void> {
  const bootstrapLogger = createLogger();
  let config: ReturnType<typeof loadConfig>;
  try {
    config = loadConfig();
  } catch (error) {
    if (error instanceof ConfigError) {
      bootstrapLogger.error(
        { event: "config.invalid", status: "FAILED", error: { name: error.name, message: error.message } },
        "configuration is invalid",
      );
    } else {
      bootstrapLogger.error(
        { event: "config.invalid", status: "FAILED", error: sanitizeError(error) },
        "configuration is invalid",
      );
    }
    process.exitCode = 1;
    return;
  }

  const app = createApplication(config);
  process.on("unhandledRejection", (reason) => {
    app.logger.error(
      { event: "process.unhandledRejection", status: "FAILED", error: sanitizeError(reason) },
      "unhandled rejection",
    );
  });

  const health = await startHealthServer(config.port);
  await app.listener.start();

  const shutdown = async () => {
    await app.listener.stop();
    health.close();
  };
  process.once("SIGINT", () => {
    void shutdown().finally(() => process.exit(0));
  });
  process.once("SIGTERM", () => {
    void shutdown().finally(() => process.exit(0));
  });
}

void main();
