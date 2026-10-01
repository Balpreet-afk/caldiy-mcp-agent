/**
 * http.ts — Streamable HTTP transport with Bearer token authentication
 * Uses StreamableHTTPServerTransport (MCP SDK >=1.1.0).
 * Single endpoint: POST /mcp  (initialize + all messages)
 *                  GET  /mcp  (optional SSE upgrade for server-push)
 *                  GET  /health (no auth)
 */
import http from "node:http";
import type Database from "better-sqlite3";
import type { Config } from "./config.js";
import { CalDiyClient } from "./caldiy/client.js";
export declare function createHttpServer(config: Config, customDb?: Database.Database, customClient?: CalDiyClient): http.Server;
//# sourceMappingURL=http.d.ts.map