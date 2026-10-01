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
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Config } from "../config.js";
export declare function registerPublicTools(_server: McpServer, _config: Config): void;
export declare const FindSlotsInput: z.ZodObject<{
    event_type_slug: z.ZodString;
    date_from: z.ZodString;
    date_to: z.ZodString;
    time_of_day_from: z.ZodOptional<z.ZodString>;
    time_of_day_to: z.ZodOptional<z.ZodString>;
    requester_email: z.ZodOptional<z.ZodString>;
    idempotency_key: z.ZodOptional<z.ZodString>;
}, "strict", z.ZodTypeAny, {
    event_type_slug: string;
    date_from: string;
    date_to: string;
    time_of_day_from?: string | undefined;
    time_of_day_to?: string | undefined;
    requester_email?: string | undefined;
    idempotency_key?: string | undefined;
}, {
    event_type_slug: string;
    date_from: string;
    date_to: string;
    time_of_day_from?: string | undefined;
    time_of_day_to?: string | undefined;
    requester_email?: string | undefined;
    idempotency_key?: string | undefined;
}>;
export declare const PlanBookingInput: z.ZodObject<{
    event_type_slug: z.ZodString;
    start: z.ZodString;
    attendee_email: z.ZodString;
    attendee_name: z.ZodString;
    attendee_timezone: z.ZodString;
    idempotency_key: z.ZodOptional<z.ZodString>;
    conversation_id: z.ZodOptional<z.ZodString>;
}, "strict", z.ZodTypeAny, {
    event_type_slug: string;
    attendee_email: string;
    start: string;
    attendee_name: string;
    attendee_timezone: string;
    idempotency_key?: string | undefined;
    conversation_id?: string | undefined;
}, {
    event_type_slug: string;
    attendee_email: string;
    start: string;
    attendee_name: string;
    attendee_timezone: string;
    idempotency_key?: string | undefined;
    conversation_id?: string | undefined;
}>;
export declare const ExecutePlanInput: z.ZodObject<{
    plan_id: z.ZodString;
    confirmed: z.ZodOptional<z.ZodBoolean>;
}, "strict", z.ZodTypeAny, {
    plan_id: string;
    confirmed?: boolean | undefined;
}, {
    plan_id: string;
    confirmed?: boolean | undefined;
}>;
export declare const GetBookingStatusInput: z.ZodObject<{
    booking_uid: z.ZodString;
    attendee_email: z.ZodString;
}, "strict", z.ZodTypeAny, {
    attendee_email: string;
    booking_uid: string;
}, {
    attendee_email: string;
    booking_uid: string;
}>;
//# sourceMappingURL=public.d.ts.map