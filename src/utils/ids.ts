import { randomBytes } from "node:crypto";

export function createPrefixedId(prefix: string): string {
  return `${prefix}-${randomBytes(4).toString("hex").toUpperCase()}`;
}
