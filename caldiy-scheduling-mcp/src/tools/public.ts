/**
 * tools/public.ts — Tool handlers for the `public` profile
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type Database from "better-sqlite3";
import type { Config } from "../config.js";
import { CalDiyClient, CalDiyError } from "../caldiy/client.js";
import { findSlots, buildPlan, executePlan } from "../planner/index.js";
import { RateLimiter, sanitizeUntrusted } from "../security/index.js";
import { logAudit } from "../store/index.js";
import type { NotifyOutbox } from "../notify/index.js";

export function registerPublicTools(
  server: McpServer,
  config: Config,
  db: Database.Database,
  client: CalDiyClient,
  notifyOutbox?: NotifyOutbox
): void {
  const rateLimiter = new RateLimiter(config.policy.limits.tool_calls_per_minute || 30);

  // 1. get_owner_info
  server.tool(
    "get_owner_info",
    "Get bookable event types, owner display name and timezone.",
    {},
    async (_args, extra) => {
      if (!rateLimiter.allow("get_owner_info")) {
        return {
          isError: true,
          content: [{ type: "text", text: "Rate limit exceeded. Please retry shortly." }],
        };
      }

      try {
        const userInfo = await client.getUserInfo();
        const eventTypes = await client.getEventTypes();

        const safeEventTypes = eventTypes.map((et) => ({
          id: et.id,
          slug: et.slug,
          length: et.length,
          description: et.description ? sanitizeUntrusted(et.description) : undefined,
        }));

        logAudit(db, {
          profile: "public",
          tool: "get_owner_info",
          client_name: extra?.sessionId,
          status: "success",
        });

        const output = {
          owner_name: userInfo.name,
          timezone: userInfo.timeZone || config.policy.timezone,
          event_types: safeEventTypes,
        };

        return {
          content: [{ type: "text", text: JSON.stringify(output, null, 2) }],
          structuredContent: output,
        };
      } catch (err: unknown) {
        logAudit(db, {
          profile: "public",
          tool: "get_owner_info",
          status: "error",
          error: (err as Error).message,
        });
        return {
          isError: true,
          content: [{ type: "text", text: `Error fetching owner info: ${(err as Error).message}` }],
        };
      }
    }
  );

  // 2. find_slots
  server.tool(
    "find_slots",
    "Find available and displaceable time slots for an event type within a date range (max 14 days).",
    {
      event_type_slug: z.string().describe("Slug of the event type, e.g. '30min'"),
      date_from: z.string().describe("Start ISO 8601 date string, e.g. '2026-10-02T00:00:00Z'"),
      date_to: z.string().describe("End ISO 8601 date string (max 14 days from date_from)"),
      time_of_day_from: z.string().optional().describe("Optional start time filter (HH:MM)"),
      time_of_day_to: z.string().optional().describe("Optional end time filter (HH:MM)"),
      requester_email: z.string().email().optional().describe("Attendee email for policy priority resolution"),
      requester_domain: z.string().optional().describe("Attendee domain for policy priority resolution"),
    },
    async (args, extra) => {
      const emailKey = args.requester_email || "anonymous";
      if (!rateLimiter.allow(`find_slots:${emailKey}`)) {
        return {
          isError: true,
          content: [{ type: "text", text: "Rate limit exceeded. Please retry shortly." }],
        };
      }

      // Validate date range <= 14 days
      const dFrom = new Date(args.date_from).getTime();
      const dTo = new Date(args.date_to).getTime();
      const maxRangeMs = 14 * 24 * 3600 * 1000;
      if (dTo - dFrom > maxRangeMs) {
        return {
          isError: true,
          content: [{ type: "text", text: "Date range cannot exceed 14 days." }],
        };
      }

      try {
        const slots = await findSlots(client, config, db, {
          eventTypeSlug: args.event_type_slug,
          dateFrom: args.date_from,
          dateTo: args.date_to,
          requesterEmail: args.requester_email,
          requesterDomain: args.requester_domain,
        });

        logAudit(db, {
          profile: "public",
          tool: "find_slots",
          client_name: extra?.sessionId,
          status: "success",
        });

        return {
          content: [{ type: "text", text: JSON.stringify(slots, null, 2) }],
          structuredContent: slots,
        };
      } catch (err: unknown) {
        logAudit(db, {
          profile: "public",
          tool: "find_slots",
          status: "error",
          error: (err as Error).message,
        });
        return {
          isError: true,
          content: [{ type: "text", text: `Error finding slots: ${(err as Error).message}` }],
        };
      }
    }
  );

  // 3. plan_booking
  server.tool(
    "plan_booking",
    "Build an execution plan to book a meeting or evaluate displacement.",
    {
      event_type_slug: z.string().describe("Slug of the event type"),
      start: z.string().describe("Requested ISO start time"),
      attendee_email: z.string().email().describe("Attendee email address"),
      attendee_name: z.string().max(200).describe("Attendee full name"),
      attendee_timezone: z.string().describe("Attendee IANA timezone"),
      idempotency_key: z.string().optional().describe("Optional idempotency key"),
      conversation_id: z.string().optional().describe("Optional untrusted conversation id for audit log"),
    },
    async (args, extra) => {
      if (!rateLimiter.allow(`plan_booking:${args.attendee_email}`)) {
        return {
          isError: true,
          content: [{ type: "text", text: "Rate limit exceeded for attendee." }],
        };
      }

      try {
        const plan = await buildPlan(client, config, db, {
          eventTypeSlug: args.event_type_slug,
          start: args.start,
          attendeeEmail: args.attendee_email.trim().toLowerCase(),
          attendeeName: sanitizeUntrusted(args.attendee_name),
          attendeeTimezone: args.attendee_timezone,
          idempotencyKey: args.idempotency_key,
          conversationId: args.conversation_id ? sanitizeUntrusted(args.conversation_id) : undefined,
        });

        logAudit(db, {
          profile: "public",
          tool: "plan_booking",
          client_name: extra?.sessionId,
          conversation_id: args.conversation_id ? sanitizeUntrusted(args.conversation_id) : undefined,
          plan_id: plan.plan_id,
          policy_decision: plan.policy.decision,
          policy_rule: plan.policy.rule,
          status: "success",
        });

        return {
          content: [{ type: "text", text: JSON.stringify(plan, null, 2) }],
          structuredContent: { ...plan } as Record<string, unknown>,
        };
      } catch (err: unknown) {
        logAudit(db, {
          profile: "public",
          tool: "plan_booking",
          status: "error",
          error: (err as Error).message,
        });
        return {
          isError: true,
          content: [{ type: "text", text: `Error building plan: ${(err as Error).message}` }],
        };
      }
    }
  );

  // 4. execute_plan
  server.tool(
    "execute_plan",
    "Execute a previously built plan.",
    {
      plan_id: z.string().describe("Plan ID to execute"),
      confirmed: z.boolean().optional().describe("Human confirmation flag for autonomy_level=1"),
    },
    async (args, extra) => {
      try {
        const result = await executePlan(
          client,
          config,
          db,
          args.plan_id,
          args.confirmed,
          notifyOutbox
        );

        logAudit(db, {
          profile: "public",
          tool: "execute_plan",
          client_name: extra?.sessionId,
          plan_id: args.plan_id,
          status: result.status === "executed" ? "success" : "denied",
        });

        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          structuredContent: result,
        };
      } catch (err: unknown) {
        logAudit(db, {
          profile: "public",
          tool: "execute_plan",
          plan_id: args.plan_id,
          status: "error",
          error: (err as Error).message,
        });
        return {
          isError: true,
          content: [{ type: "text", text: `Error executing plan: ${(err as Error).message}` }],
        };
      }
    }
  );

  // 5. book_meeting
  server.tool(
    "book_meeting",
    "Direct wrapper to book a free slot without displacement.",
    {
      event_type_slug: z.string().describe("Slug of the event type"),
      start: z.string().describe("Requested ISO start time"),
      attendee_email: z.string().email().describe("Attendee email"),
      attendee_name: z.string().max(200).describe("Attendee full name"),
      attendee_timezone: z.string().describe("Attendee timezone"),
      idempotency_key: z.string().optional().describe("Optional idempotency key"),
      conversation_id: z.string().optional().describe("Optional conversation id for audit log"),
    },
    async (args, extra) => {
      if (!rateLimiter.allow(`book_meeting:${args.attendee_email}`)) {
        return {
          isError: true,
          content: [{ type: "text", text: "Rate limit exceeded." }],
        };
      }

      try {
        const plan = await buildPlan(client, config, db, {
          eventTypeSlug: args.event_type_slug,
          start: args.start,
          attendeeEmail: args.attendee_email.trim().toLowerCase(),
          attendeeName: sanitizeUntrusted(args.attendee_name),
          attendeeTimezone: args.attendee_timezone,
          idempotencyKey: args.idempotency_key,
          conversationId: args.conversation_id ? sanitizeUntrusted(args.conversation_id) : undefined,
        });

        if (plan.policy.decision !== "auto" || plan.steps.some((s) => s.op === "reschedule")) {
          return {
            isError: true,
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  code: "slot_unavailable",
                  message: "Slot is occupied and cannot be auto-booked via book_meeting. Use plan_booking to evaluate displacement.",
                }),
              },
            ],
          };
        }

        const exec = await executePlan(
          client,
          config,
          db,
          plan.plan_id,
          true,
          notifyOutbox
        );

        return {
          content: [{ type: "text", text: JSON.stringify(exec, null, 2) }],
          structuredContent: exec,
        };
      } catch (err: unknown) {
        logAudit(db, {
          profile: "public",
          tool: "book_meeting",
          status: "error",
          error: (err as Error).message,
        });
        return {
          isError: true,
          content: [{ type: "text", text: `Error booking meeting: ${(err as Error).message}` }],
        };
      }
    }
  );

  // 6. get_booking_status
  server.tool(
    "get_booking_status",
    "Get status of an existing booking. Caller must provide the matching attendee email.",
    {
      booking_uid: z.string().describe("UID of the booking"),
      attendee_email: z.string().email().describe("Attendee email address to verify identity"),
    },
    async (args, extra) => {
      try {
        const booking = await client.getBooking(args.booking_uid);
        const matches = (booking.attendees || []).some(
          (a) => a.email.toLowerCase() === args.attendee_email.toLowerCase()
        );

        if (!matches) {
          return {
            isError: true,
            content: [{ type: "text", text: `Booking with UID '${args.booking_uid}' not found for attendee.` }],
          };
        }

        const safeOutput = {
          uid: booking.uid,
          start: booking.start,
          end: booking.end,
          status: booking.status,
        };

        logAudit(db, {
          profile: "public",
          tool: "get_booking_status",
          booking_uid: args.booking_uid,
          status: "success",
        });

        return {
          content: [{ type: "text", text: JSON.stringify(safeOutput, null, 2) }],
          structuredContent: safeOutput,
        };
      } catch (err: unknown) {
        return {
          isError: true,
          content: [{ type: "text", text: `Error retrieving booking: ${(err as Error).message}` }],
        };
      }
    }
  );

  // 7. reschedule_own_booking
  server.tool(
    "reschedule_own_booking",
    "Reschedule attendee's own booking if permitted by policy.",
    {
      booking_uid: z.string().describe("Booking UID to reschedule"),
      attendee_email: z.string().email().describe("Attendee email to verify ownership"),
      new_start: z.string().describe("Requested new ISO start time"),
      rescheduling_reason: z.string().optional().describe("Optional reason for reschedule"),
    },
    async (args, extra) => {
      if (!config.policy.public.allow_self_reschedule) {
        return {
          isError: true,
          content: [{ type: "text", text: "Self-rescheduling is disabled by owner policy." }],
        };
      }

      try {
        const booking = await client.getBooking(args.booking_uid);
        const matches = (booking.attendees || []).some(
          (a) => a.email.toLowerCase() === args.attendee_email.toLowerCase()
        );

        if (!matches) {
          return {
            isError: true,
            content: [{ type: "text", text: `Booking '${args.booking_uid}' not found for attendee.` }],
          };
        }

        const updated = await client.rescheduleBooking(args.booking_uid, {
          start: args.new_start,
          reschedulingReason: args.rescheduling_reason
            ? sanitizeUntrusted(args.rescheduling_reason)
            : "Rescheduled by attendee",
        });

        logAudit(db, {
          profile: "public",
          tool: "reschedule_own_booking",
          booking_uid: args.booking_uid,
          old_value: booking.start,
          new_value: args.new_start,
          status: "success",
        });

        const safeOutput = {
          uid: updated.uid,
          start: updated.start,
          end: updated.end,
          status: updated.status,
        };

        return {
          content: [{ type: "text", text: JSON.stringify(safeOutput, null, 2) }],
          structuredContent: safeOutput,
        };
      } catch (err: unknown) {
        return {
          isError: true,
          content: [{ type: "text", text: `Error rescheduling booking: ${(err as Error).message}` }],
        };
      }
    }
  );

  // 8. cancel_own_booking
  server.tool(
    "cancel_own_booking",
    "Cancel attendee's own booking if permitted by policy.",
    {
      booking_uid: z.string().describe("Booking UID to cancel"),
      attendee_email: z.string().email().describe("Attendee email to verify ownership"),
      cancellation_reason: z.string().optional().describe("Optional reason for cancellation"),
    },
    async (args, extra) => {
      if (!config.policy.public.allow_self_cancel) {
        return {
          isError: true,
          content: [{ type: "text", text: "Self-cancellation is disabled by owner policy." }],
        };
      }

      try {
        const booking = await client.getBooking(args.booking_uid);
        const matches = (booking.attendees || []).some(
          (a) => a.email.toLowerCase() === args.attendee_email.toLowerCase()
        );

        if (!matches) {
          return {
            isError: true,
            content: [{ type: "text", text: `Booking '${args.booking_uid}' not found for attendee.` }],
          };
        }

        await client.cancelBooking(args.booking_uid, {
          cancellationReason: args.cancellation_reason
            ? sanitizeUntrusted(args.cancellation_reason)
            : "Cancelled by attendee",
        });

        logAudit(db, {
          profile: "public",
          tool: "cancel_own_booking",
          booking_uid: args.booking_uid,
          status: "success",
        });

        const safeOutput = {
          uid: args.booking_uid,
          status: "cancelled",
        };

        return {
          content: [{ type: "text", text: JSON.stringify(safeOutput, null, 2) }],
          structuredContent: safeOutput,
        };
      } catch (err: unknown) {
        return {
          isError: true,
          content: [{ type: "text", text: `Error cancelling booking: ${(err as Error).message}` }],
        };
      }
    }
  );
}
