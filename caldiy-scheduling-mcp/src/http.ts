/**
 * http.ts — Streamable HTTP transport with Bearer token authentication
 * Uses StreamableHTTPServerTransport (MCP SDK >=1.1.0).
 * Single endpoint: POST /mcp  (initialize + all messages)
 *                  GET  /mcp  (optional SSE upgrade for server-push)
 *                  GET  /health (no auth)
 */

import http from "node:http";
import type Database from "better-sqlite3";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Config } from "./config.js";
import { CalDiyClient } from "./caldiy/client.js";
import { createServer } from "./server.js";
import { openStore } from "./store/index.js";

function extractToken(req: http.IncomingMessage, url: URL): string {
  const authHeader = req.headers["authorization"];
  if (authHeader) {
    return authHeader.startsWith("Bearer ")
      ? authHeader.slice(7).trim()
      : authHeader.trim();
  }
  return (url.searchParams.get("token") || url.searchParams.get("auth") || "").trim();
}

export function createHttpServer(
  config: Config,
  customDb?: Database.Database,
  customClient?: CalDiyClient
): http.Server {
  const db = customDb || openStore(config.DATA_DIR);
  const client = customClient || new CalDiyClient(config);
  // One transport per session (stateful mode)
  const transports = new Map<string, StreamableHTTPServerTransport>();

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

    // Health check — no auth required
    if (url.pathname === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok", service: "caldiy-scheduling-mcp" }));
      return;
    }

    // All MCP traffic goes through /mcp
    if (url.pathname === "/mcp") {
      // Auth check
      const token = extractToken(req, url);
      if (config.MCP_HTTP_BEARER_TOKEN && (!token || token !== config.MCP_HTTP_BEARER_TOKEN)) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Unauthorized: Invalid or missing bearer token" }));
        return;
      }

      // Resume existing session if client sends Mcp-Session-Id header
      const sessionId = req.headers["mcp-session-id"] as string | undefined;
      let transport = sessionId ? transports.get(sessionId) : undefined;

      if (!transport) {
        // New session — create transport + MCP server
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => crypto.randomUUID(),
          onsessioninitialized: (id) => {
            transports.set(id, transport!);
          },
        });
        transport.onclose = () => {
          if (transport!.sessionId) transports.delete(transport!.sessionId);
        };
        const mcpServer = createServer(config, db, client).server;
        await mcpServer.connect(transport);
      }

      await transport.handleRequest(req, res);
      return;
    }

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
  });

  return server;
}
