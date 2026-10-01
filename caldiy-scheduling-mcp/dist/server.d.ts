/**
 * server.ts — MCP Server + tool registration by profile
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type Database from "better-sqlite3";
import type { Config } from "./config.js";
import { CalDiyClient } from "./caldiy/client.js";
export declare function createServer(config: Config, customDb?: Database.Database, customClient?: CalDiyClient): {
    server: McpServer;
    db: Database.Database;
    client: CalDiyClient;
};
//# sourceMappingURL=server.d.ts.map