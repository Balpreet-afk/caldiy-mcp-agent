/**
 * server.ts — MCP Server + tool registration by profile
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { CalDiyClient } from "./caldiy/client.js";
import { openStore } from "./store/index.js";
import { registerPublicTools } from "./tools/public.js";
import { registerOwnerTools } from "./tools/owner.js";
import { NotifyOutbox } from "./notify/index.js";
export function createServer(config, customDb, customClient) {
    const db = customDb || openStore(config.DATA_DIR);
    const client = customClient || new CalDiyClient(config);
    const notifyOutbox = new NotifyOutbox(db, config.NOTIFY_WEBHOOK_URL);
    const server = new McpServer({
        name: "caldiy-scheduling-mcp",
        version: "0.1.0",
    });
    // Always register public tools
    registerPublicTools(server, config, db, client, notifyOutbox);
    // Register owner tools only when MCP_PROFILE=owner
    if (config.MCP_PROFILE === "owner") {
        registerOwnerTools(server, config, db, client);
    }
    return { server, db, client };
}
//# sourceMappingURL=server.js.map