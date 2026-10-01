/**
 * tools/owner.ts — Tool handlers for the `owner` profile
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type Database from "better-sqlite3";
import type { Config } from "../config.js";
import { CalDiyClient } from "../caldiy/client.js";
export declare function registerOwnerTools(server: McpServer, config: Config, db: Database.Database, client: CalDiyClient): void;
//# sourceMappingURL=owner.d.ts.map