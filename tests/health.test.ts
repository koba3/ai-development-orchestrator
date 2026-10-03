import { describe, expect, it } from "vitest";
import { startHealthServer } from "../src/health/health.server.js";

describe("health server", () => {
  it("answers /health", async () => {
    const server = await startHealthServer(0);
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("expected a tcp address");
    }
    try {
      const response = await fetch(`http://127.0.0.1:${address.port}/health`);
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ ok: true });
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });
});
