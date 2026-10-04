import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

export type RouteHandler = (request: IncomingMessage, response: ServerResponse) => Promise<boolean>;

export function startHealthServer(port: number, route?: RouteHandler): Promise<Server> {
  const server = createServer((request, response) => {
    void handleRequest(request, response, route).catch(() => {
      if (response.headersSent) {
        response.end();
        return;
      }
      response.writeHead(500, { "content-type": "application/json" });
      response.end(JSON.stringify({ ok: false }));
    });
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, () => resolve(server));
  });
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  route: RouteHandler | undefined,
): Promise<void> {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  if (request.method === "GET" && url.pathname === "/health") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ ok: true }));
    return;
  }
  if (route && await route(request, response)) {
    return;
  }
  response.writeHead(404, { "content-type": "application/json" });
  response.end(JSON.stringify({ ok: false }));
}
