/**
 * tools/public.ts — Tool handlers for the `public` profile
 *
 * Tools: get_owner_info, find_slots, plan_booking, execute_plan,
 *        book_meeting, get_booking_status,
 *        reschedule_own_booking, cancel_own_booking
 *
 * Security rules (spec §10):
 *  - No private data (titles, attendees, locations, links) in responses
 *  - displaceable_slots are opaque
 *  - Attendee free text only in `untrusted` field, sanitized
 *  - Public profile callers cannot set priority
 *  - Unknown fields rejected (zod .strict())
 */
import { z } from "zod";
export function registerPublicTools(_server, _config) {
    // TODO: implement each tool
    // server.tool("get_owner_info", ...)
    // server.tool("find_slots", ...)
    // server.tool("plan_booking", ...)
    // server.tool("execute_plan", ...)
    // server.tool("book_meeting", ...)
    // server.tool("get_booking_status", ...)
    // server.tool("reschedule_own_booking", ...)
    // server.tool("cancel_own_booking", ...)
}
// ---------------------------------------------------------------------------
// Input schemas (zod .strict() — reject unknown fields)
// ---------------------------------------------------------------------------
export const FindSlotsInput = z
    .object({
    event_type_slug: z.string(),
    date_from: z.string(), // ISO 8601 date
    date_to: z.string(), // max 14 days ahead
    time_of_day_from: z.string().optional(), // HH:MM
    time_of_day_to: z.string().optional(),
    requester_email: z.string().email().optional(),
    idempotency_key: z.string().optional(),
})
    .strict();
export const PlanBookingInput = z
    .object({
    event_type_slug: z.string(),
    start: z.string(),
    attendee_email: z.string().email(),
    attendee_name: z.string().max(200),
    attendee_timezone: z.string(),
    idempotency_key: z.string().optional(),
    conversation_id: z.string().optional(), // untrusted, for audit only
})
    .strict();
export const ExecutePlanInput = z
    .object({
    plan_id: z.string(),
    confirmed: z.boolean().optional(),
})
    .strict();
export const GetBookingStatusInput = z
    .object({
    booking_uid: z.string(),
    attendee_email: z.string().email(),
})
    .strict();
//# sourceMappingURL=public.js.map