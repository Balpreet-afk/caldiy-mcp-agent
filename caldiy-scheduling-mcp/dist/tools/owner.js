/**
 * tools/owner.ts — Tool handlers for the `owner` profile
 */
import { z } from "zod";
import { derivePriority, evaluateDisplacement, checkAutonomyGate, } from "../policy/engine.js";
import { getStoredPriority, setStoredPriority, listPendingApprovals, getApproval, updateApprovalStatus, queryAudit, logAudit, } from "../store/index.js";
import { sanitizeUntrusted } from "../security/index.js";
const PrioritySchema = z.enum(["CRITICAL", "HIGH", "NORMAL", "LOW"]);
export function registerOwnerTools(server, config, db, client) {
    // 1. get_schedule
    server.tool("get_schedule", "Get full owner schedule for a date range with attendee details.", {
        date_from: z.string().describe("Start ISO date string"),
        date_to: z.string().describe("End ISO date string"),
    }, async (args) => {
        try {
            const bookings = await client.getBookings({
                afterStart: args.date_from,
                beforeEnd: args.date_to,
            });
            const safeBookings = bookings.map((b) => ({
                uid: b.uid,
                title: b.title,
                start: b.start,
                end: b.end,
                status: b.status,
                attendees: (b.attendees || []).map((a) => ({
                    name: sanitizeUntrusted(a.name),
                    email: a.email,
                    timeZone: a.timeZone,
                })),
                untrusted: {
                    notes: b.metadata?.notes ? sanitizeUntrusted(String(b.metadata.notes)) : undefined,
                },
            }));
            logAudit(db, {
                profile: "owner",
                tool: "get_schedule",
                status: "success",
            });
            return {
                content: [{ type: "text", text: JSON.stringify(safeBookings, null, 2) }],
                structuredContent: { schedule: safeBookings },
            };
        }
        catch (err) {
            return {
                isError: true,
                content: [{ type: "text", text: `Error fetching schedule: ${err.message}` }],
            };
        }
    });
    // 2. get_booking
    server.tool("get_booking", "Get single booking in full detail.", {
        booking_uid: z.string().describe("Booking UID"),
    }, async (args) => {
        try {
            const booking = await client.getBooking(args.booking_uid);
            const stored = getStoredPriority(db, booking.uid);
            const safeBooking = {
                ...booking,
                attendees: (booking.attendees || []).map((a) => ({
                    ...a,
                    name: sanitizeUntrusted(a.name),
                })),
                effective_priority: stored?.priority || derivePriority(config.policy, {
                    title: booking.title,
                    attendeeEmail: booking.attendees[0]?.email,
                }),
            };
            logAudit(db, {
                profile: "owner",
                tool: "get_booking",
                booking_uid: args.booking_uid,
                status: "success",
            });
            return {
                content: [{ type: "text", text: JSON.stringify(safeBooking, null, 2) }],
                structuredContent: safeBooking,
            };
        }
        catch (err) {
            return {
                isError: true,
                content: [{ type: "text", text: `Error fetching booking: ${err.message}` }],
            };
        }
    });
    // 3. get_meeting_priority
    server.tool("get_meeting_priority", "Get priority for a specific booking.", {
        booking_uid: z.string().describe("Booking UID"),
    }, async (args) => {
        try {
            const stored = getStoredPriority(db, args.booking_uid);
            if (stored) {
                return {
                    content: [{ type: "text", text: JSON.stringify(stored, null, 2) }],
                    structuredContent: { ...stored },
                };
            }
            const booking = await client.getBooking(args.booking_uid);
            const derived = derivePriority(config.policy, {
                title: booking.title,
                attendeeEmail: booking.attendees[0]?.email,
            });
            const result = {
                booking_uid: args.booking_uid,
                priority: derived,
                source: "rule",
            };
            return {
                content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
                structuredContent: result,
            };
        }
        catch (err) {
            return {
                isError: true,
                content: [{ type: "text", text: `Error getting priority: ${err.message}` }],
            };
        }
    });
    // 4. set_meeting_priority
    server.tool("set_meeting_priority", "Override priority for a booking as owner.", {
        booking_uid: z.string().describe("Booking UID"),
        priority: PrioritySchema.describe("New priority level"),
        reason: z.string().optional().describe("Reason for manual override"),
    }, async (args) => {
        try {
            setStoredPriority(db, args.booking_uid, args.priority, "owner", args.reason ? sanitizeUntrusted(args.reason) : undefined);
            logAudit(db, {
                profile: "owner",
                tool: "set_meeting_priority",
                booking_uid: args.booking_uid,
                new_value: args.priority,
                status: "success",
            });
            const result = {
                booking_uid: args.booking_uid,
                priority: args.priority,
                source: "owner",
                reason: args.reason,
            };
            return {
                content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
                structuredContent: result,
            };
        }
        catch (err) {
            return {
                isError: true,
                content: [{ type: "text", text: `Error setting priority: ${err.message}` }],
            };
        }
    });
    // 5. get_policy
    server.tool("get_policy", "Get effective scheduling policy configuration.", {}, async () => {
        return {
            content: [{ type: "text", text: JSON.stringify(config.policy, null, 2) }],
            structuredContent: config.policy,
        };
    });
    // 6. check_policy
    server.tool("check_policy", "Dry-evaluate policy displacement and autonomy gate without side effects.", {
        requested_priority: PrioritySchema.describe("Priority of incoming request"),
        existing_priority: PrioritySchema.describe("Priority of existing meeting"),
        has_external_attendees: z.boolean().optional().describe("Whether existing meeting has external attendees"),
        hours_until_meeting: z.number().optional().describe("Hours until meeting starts"),
    }, async (args) => {
        const decision = evaluateDisplacement(config.policy, {
            requestedPriority: args.requested_priority,
            existingPriority: args.existing_priority,
            hasExternalAttendees: args.has_external_attendees,
            hoursUntilMeeting: args.hours_until_meeting,
        });
        const autonomyGate = checkAutonomyGate(config.policy, config.policy.autonomy_level, decision);
        const output = {
            displacement_decision: decision,
            autonomy_gate: autonomyGate,
        };
        return {
            content: [{ type: "text", text: JSON.stringify(output, null, 2) }],
            structuredContent: output,
        };
    });
    // 7. list_approvals
    server.tool("list_approvals", "List all pending displacement approval requests.", {}, async () => {
        const pending = listPendingApprovals(db);
        return {
            content: [{ type: "text", text: JSON.stringify(pending, null, 2) }],
            structuredContent: { approvals: pending },
        };
    });
    // 8. approve_action
    server.tool("approve_action", "Approve a pending displacement approval request.", {
        approval_id: z.string().describe("Approval ID to approve"),
    }, async (args) => {
        const appr = getApproval(db, args.approval_id);
        if (!appr) {
            return {
                isError: true,
                content: [{ type: "text", text: `Approval '${args.approval_id}' not found.` }],
            };
        }
        if (appr.status !== "pending") {
            return {
                isError: true,
                content: [{ type: "text", text: `Approval is already '${appr.status}'.` }],
            };
        }
        updateApprovalStatus(db, args.approval_id, "approved");
        logAudit(db, {
            profile: "owner",
            tool: "approve_action",
            plan_id: appr.plan_id,
            status: "success",
        });
        const output = { approval_id: args.approval_id, status: "approved", plan_id: appr.plan_id };
        return {
            content: [{ type: "text", text: JSON.stringify(output, null, 2) }],
            structuredContent: output,
        };
    });
    // 9. reject_action
    server.tool("reject_action", "Reject a pending displacement approval request.", {
        approval_id: z.string().describe("Approval ID to reject"),
        reason: z.string().optional().describe("Optional rejection reason"),
    }, async (args) => {
        const appr = getApproval(db, args.approval_id);
        if (!appr) {
            return {
                isError: true,
                content: [{ type: "text", text: `Approval '${args.approval_id}' not found.` }],
            };
        }
        updateApprovalStatus(db, args.approval_id, "rejected");
        logAudit(db, {
            profile: "owner",
            tool: "reject_action",
            plan_id: appr.plan_id,
            status: "success",
        });
        const output = { approval_id: args.approval_id, status: "rejected", reason: args.reason };
        return {
            content: [{ type: "text", text: JSON.stringify(output, null, 2) }],
            structuredContent: output,
        };
    });
    // 10. list_audit
    server.tool("list_audit", "Query the immutable SQLite audit log.", {
        booking_uid: z.string().optional().describe("Filter by booking UID"),
        plan_id: z.string().optional().describe("Filter by plan ID"),
        tool: z.string().optional().describe("Filter by tool name"),
        limit: z.number().int().optional().describe("Max rows to return (default 100)"),
    }, async (args) => {
        const rows = queryAudit(db, {
            booking_uid: args.booking_uid,
            plan_id: args.plan_id,
            tool: args.tool,
            limit: args.limit || 50,
        });
        return {
            content: [{ type: "text", text: JSON.stringify(rows, null, 2) }],
            structuredContent: { audit_log: rows },
        };
    });
}
//# sourceMappingURL=owner.js.map