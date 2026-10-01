/**
 * tools/public.ts — Tool handlers for the `public` profile
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type Database from "better-sqlite3";
import type { Config } from "../config.js";
import { CalDiyClient } from "../caldiy/client.js";
import type { NotifyOutbox } from "../notify/index.js";
export declare function registerPublicTools(server: McpServer, config: Config, db: Database.Database, client: CalDiyClient, notifyOutbox?: NotifyOutbox): void;
//# sourceMappingURL=public.d.ts.map