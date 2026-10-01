/**
 * planner/index.ts — Conflict discovery, displacement & saga orchestration
 *
 * Responsibilities (spec §6, §7):
 *  - Fetch owner bookings for requested window
 *  - Compute free_slots and displaceable_slots (opaque to public profile)
 *  - Build ordered plan steps (reschedule displaced → create new booking)
 *  - Pick alternative slot for displaced meeting (earliest, within working hours)
 *  - Execute plan as a saga with compensation on failure
 *  - Re-validate every step immediately before execution (stale-slot check)
 */
import type { Config } from "../config.js";
import type { CalDiyClient } from "../caldiy/client.js";
import type { Slot } from "../caldiy/types.js";
import type { Priority } from "../policy/engine.js";
export interface FreeSlot extends Slot {
}
export interface DisplacableSlot extends Slot {
    requires: "none" | "approval";
}
export interface PlanStep {
    op: "reschedule" | "book" | "cancel";
    bookingRef?: string;
    eventTypeSlug?: string;
    start?: string;
    end?: string;
    to?: string;
}
export interface Plan {
    plan_id: string;
    expires_at: string;
    steps: PlanStep[];
    policy: {
        decision: "auto" | "approval_required" | "denied" | "suggestion_only";
        rule: string;
        reasons: string[];
    };
    autonomy_gate: "ok" | "needs_confirmation" | "suggestion_only";
}
/**
 * Discover free and displaceable slots for a given event type and date range.
 * displaceable_slots are opaque — never include booking owner/title details.
 */
export declare function findSlots(_client: CalDiyClient, _config: Config, _params: {
    eventTypeSlug: string;
    dateFrom: string;
    dateTo: string;
    requesterEmail?: string;
    requesterDomain?: string;
    requestedPriority: Priority;
}): Promise<{
    free_slots: FreeSlot[];
    displaceable_slots: DisplacableSlot[];
}>;
/**
 * Build and store a plan. Returns the plan with TTL.
 * All policy checks happen here — planner is the single gate.
 */
export declare function buildPlan(_client: CalDiyClient, _config: Config, _params: {
    eventTypeSlug: string;
    start: string;
    attendeeEmail: string;
    attendeeName: string;
    attendeeTimezone: string;
    requestedPriority: Priority;
    idempotencyKey?: string;
}): Promise<Plan>;
/**
 * Execute a previously built plan as a saga (spec §7).
 * Re-validates all steps before touching Cal.diy.
 * Compensation runs if a later step fails.
 */
export declare function executePlan(_client: CalDiyClient, _config: Config, _planId: string, _confirmed?: boolean): Promise<{
    status: "executed" | "approval_required" | "denied";
    result?: unknown;
}>;
//# sourceMappingURL=index.d.ts.map