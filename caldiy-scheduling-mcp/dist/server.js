/**
 * server.ts — MCP Server + tool registration by profile
 *
 * Tools NOT in the active MCP_PROFILE are never registered (spec §2).
 * Public profile tools: get_owner_info, find_slots, plan_booking,
 *   execute_plan, book_meeting, get_booking_status,
 *   reschedule_own_booking, cancel_own_booking
 * Owner profile adds: get_schedule, get_booking, get_meeting_priority,
 *   set_meeting_priority, get_policy, check_policy,
 *   list_approvals, approve_action, reject_action, list_audit
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
// TODO: import tool handlers once each is implemented
// import { registerPublicTools } from "./tools/public.js";
// import { registerOwnerTools } from "./tools/owner.js";
export function createServer(config) {
    const server = new McpServer({
        name: "caldiy-scheduling-mcp",
        version: "0.1.0",
    });
    // Always register public tools
    // registerPublicTools(server, config);
    if (config.MCP_PROFILE === "owner") {
        // registerOwnerTools(server, config);
    }
    return server;
}
//# sourceMappingURL=server.js.map