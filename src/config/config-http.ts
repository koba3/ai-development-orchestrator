import { createHash, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { ADMIN_PAGE_HTML } from "./admin-page.js";
import { ConfigError } from "./index.js";
import type { RuntimeConfiguration } from "./runtime-config.js";
import { sanitizeError } from "../utils/errors.js";
import type { AppLogger } from "../utils/logger.js";

export interface ConfigHttpOptions {
  adminToken: string;
  runtime: RuntimeConfiguration;
  logger: AppLogger;
  reloadSlack: () => Promise<void>;
  reloadProjects: () => void;
}

export function handleConfigHttp(
  request: IncomingMessage,
  response: ServerResponse,
  options: ConfigHttpOptions,
): Promise<boolean> {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  if (request.method === "GET" && url.pathname === "/admin") {
    response.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    });
    response.end(ADMIN_PAGE_HTML);
    return Promise.resolve(true);
  }
  if (!url.pathname.startsWith("/api/config/")) {
    return Promise.resolve(false);
  }
  if (!authorized(request, options.adminToken)) {
    sendJson(response, 401, { error: "unauthorized" });
    return Promise.resolve(true);
  }
  return routeConfig(request, response, url.pathname, options);
}

async function routeConfig(
  request: IncomingMessage,
  response: ServerResponse,
  pathname: string,
  options: ConfigHttpOptions,
): Promise<boolean> {
  try {
    if (request.method === "GET" && pathname === "/api/config/slack") {
      sendJson(response, 200, { connections: options.runtime.publicSlack() });
      return true;
    }
    if (request.method === "PUT" && pathname === "/api/config/slack") {
      const connections = options.runtime.replaceSlack(await readJson(request));
      try {
        await options.reloadSlack();
      } catch (error) {
        options.logger.error(
          { event: "config.slack.restart.failed", status: "FAILED", error: sanitizeError(error) },
          "saved slack configuration, but restarting connections failed",
        );
        sendJson(response, 500, { error: "Slack 接続は保存しましたが、再起動に失敗しました" });
        return true;
      }
      sendJson(response, 200, { connections });
      return true;
    }
    if (request.method === "GET" && pathname === "/api/config/projects") {
      sendJson(response, 200, options.runtime.projectSettings());
      return true;
    }
    if (request.method === "PUT" && pathname === "/api/config/projects") {
      const settings = options.runtime.replaceProjects(await readJson(request));
      options.reloadProjects();
      sendJson(response, 200, settings);
      return true;
    }
    sendJson(response, 404, { error: "not found" });
    return true;
  } catch (error) {
    if (error instanceof ConfigError) {
      sendJson(response, 400, { error: error.message });
      return true;
    }
    options.logger.error(
      { event: "config.http.failed", status: "FAILED", error: sanitizeError(error) },
      "configuration request failed",
    );
    sendJson(response, 500, { error: "configuration request failed" });
    return true;
  }
}

function authorized(request: IncomingMessage, expected: string): boolean {
  const header = request.headers.authorization;
  const value = Array.isArray(header) ? header[0] ?? "" : header ?? "";
  const provided = /^Bearer (.+)$/.exec(value)?.[1] ?? "";
  const left = createHash("sha256").update(provided).digest();
  const right = createHash("sha256").update(expected).digest();
  return timingSafeEqual(left, right);
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 1_000_000) {
      throw new ConfigError("request body is too large");
    }
    chunks.push(buffer);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  if (text.trim().length === 0) {
    throw new ConfigError("request body is empty");
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new ConfigError("request body is not valid JSON");
  }
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(body));
}
