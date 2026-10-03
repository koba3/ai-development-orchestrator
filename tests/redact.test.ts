import { describe, expect, it } from "vitest";
import { redactSecrets } from "../src/utils/redact.js";
import { sanitizeError } from "../src/utils/errors.js";

describe("redactSecrets", () => {
  it("removes tokens before they reach the planner or task text", () => {
    const result = redactSecrets("key sk-abcdefghijklmnopqrstuvwxyz を設定して");
    expect(result.redacted).toBe(true);
    expect(result.text).not.toContain("sk-abcdefghijklmnopqrstuvwxyz");
    expect(result.text).toContain("[REDACTED]");
  });
});

describe("sanitizeError", () => {
  it("removes bearer tokens from error messages", () => {
    const sanitized = sanitizeError(new Error("request failed Bearer sk-abcdefghijklmnopqrstuvwxyz"));
    expect(sanitized.message).not.toContain("sk-abcdefghijklmnopqrstuvwxyz");
    expect(sanitized.name).toBe("Error");
  });
});
