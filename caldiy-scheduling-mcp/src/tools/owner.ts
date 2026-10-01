/**
 * tools/owner.ts — Tool handlers for the `owner` profile (in addition to public tools)
 *
 * Tools: get_schedule, get_booking, get_meeting_priority, set_meeting_priority,
 *        get_policy, check_policy,
 *        list_approvals, approve_action, reject_action, list_audit
 *
 * Approvals are NEVER exposed on the public profile (spec §8).
 * Attendee free text returned only in `untrusted` field (spec §10).
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Config } from "../config.js";

export function registerOwnerTools(_server: McpServer, _config: Config): void {
  // TODO: implement each tool
  // server.tool("get_schedule", ...)
  // server.tool("get_booking", ...)
  // server.tool("get_meeting_priority", ...)
  // server.tool("set_meeting_priority", ...)
  // server.tool("get_policy", ...)
  // server.tool("check_policy", ...)
  // server.tool("list_approvals", ...)
  // server.tool("approve_action", ...)
  // server.tool("reject_action", ...)
  // server.tool("list_audit", ...)
}
