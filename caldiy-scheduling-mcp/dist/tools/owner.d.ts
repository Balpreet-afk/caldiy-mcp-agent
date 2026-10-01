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
export declare function registerOwnerTools(_server: McpServer, _config: Config): void;
//# sourceMappingURL=owner.d.ts.map