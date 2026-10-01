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
import type { Config } from "./config.js";
export declare function createServer(config: Config): McpServer;
//# sourceMappingURL=server.d.ts.map