/**
 * index.ts — Bootstrap & transport selection
 *
 * Reads MCP_TRANSPORT env var and starts either:
 *  - StdioServerTransport  (default, for local / Antigravity)
 *  - StreamableHTTPServerTransport  (optional, bearer-token protected)
 */
import { loadConfig } from "./config.js";
import { createServer } from "./server.js";
async function main() {
    const config = loadConfig();
    const server = createServer(config);
    if (config.MCP_TRANSPORT === "stdio") {
        const { StdioServerTransport } = await import("@modelcontextprotocol/sdk/server/stdio.js");
        const transport = new StdioServerTransport();
        await server.connect(transport);
    }
    else {
        // TODO: StreamableHTTPServerTransport on MCP_HTTP_PORT
        // Bind to localhost, validate Origin, require bearer token (constant-time compare)
        throw new Error("HTTP transport not yet implemented");
    }
}
main().catch((err) => {
    console.error(err);
    process.exit(1);
});
//# sourceMappingURL=index.js.map