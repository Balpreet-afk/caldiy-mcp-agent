/**
 * index.ts — Bootstrap & transport selection
 */
import { loadConfig } from "./config.js";
import { createServer } from "./server.js";
import { createHttpServer } from "./http.js";
async function main() {
    const config = loadConfig();
    if (config.MCP_TRANSPORT === "stdio") {
        const { server } = createServer(config);
        const { StdioServerTransport } = await import("@modelcontextprotocol/sdk/server/stdio.js");
        const transport = new StdioServerTransport();
        await server.connect(transport);
    }
    else if (config.MCP_TRANSPORT === "http") {
        const httpServer = createHttpServer(config);
        httpServer.listen(config.MCP_HTTP_PORT, () => {
            console.log(`MCP HTTP server listening on port ${config.MCP_HTTP_PORT} (profile: ${config.MCP_PROFILE})`);
        });
    }
}
main().catch((err) => {
    console.error(err);
    process.exit(1);
});
//# sourceMappingURL=index.js.map