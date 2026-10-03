import { Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import { createLogger } from "../src/utils/logger.js";

describe("createLogger", () => {
  it("writes timestamp, event, status, and task fields without secrets", async () => {
    const lines: string[] = [];
    const destination = new Writable({
      write(chunk, _encoding, callback) {
        lines.push(String(chunk));
        callback();
      },
    });
    const logger = createLogger({ level: "info", destination });
    logger.info(
      {
        taskId: "TASK-1",
        agentType: "backend",
        event: "task.created",
        status: "READY",
        apiKey: "sk-secret",
        token: "xoxb-secret",
      },
      "task created",
    );
    await new Promise((resolve) => setImmediate(resolve));
    const record = JSON.parse(lines.join("")) as Record<string, unknown>;
    expect(record.time).toEqual(expect.any(String));
    expect(record.taskId).toBe("TASK-1");
    expect(record.agentType).toBe("backend");
    expect(record.event).toBe("task.created");
    expect(record.status).toBe("READY");
    expect(record.apiKey).toBe("[REDACTED]");
    expect(record.token).toBe("[REDACTED]");
    expect(JSON.stringify(record)).not.toContain("sk-secret");
    expect(JSON.stringify(record)).not.toContain("xoxb-secret");
  });
});
