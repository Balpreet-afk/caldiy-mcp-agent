/**
 * planner/index.ts — Conflict discovery, displacement & saga orchestration
 */
import type Database from "better-sqlite3";
import type { Config, Priority } from "../config.js";
import type { CalDiyClient } from "../caldiy/client.js";
import type { Slot, Attendee } from "../caldiy/types.js";
import type { NotifyOutbox } from "../notify/index.js";
export interface FreeSlot extends Slot {
}
export interface DisplacableSlot extends Slot {
    requires: "none" | "approval";
}
export interface PlanStep {
    op: "reschedule" | "book" | "cancel";
    bookingRef?: string;
    originalStart?: string;
    eventTypeSlug?: string;
    eventTypeId?: number;
    start?: string;
    end?: string;
    to?: string;
    attendee?: Attendee;
    metadata?: Record<string, unknown>;
}
export interface PlanPolicyInfo {
    decision: "auto" | "approval_required" | "denied" | "suggestion_only";
    rule: string;
    reasons: string[];
}
export interface Plan {
    plan_id: string;
    expires_at: string;
    steps: PlanStep[];
    policy: PlanPolicyInfo;
    autonomy_gate: "ok" | "needs_confirmation" | "suggestion_only";
    approval_id?: string;
}
/**
 * Discover free and displaceable slots for a given event type and date range.
 * displaceable_slots are opaque — never include booking owner/title details.
 */
export declare function findSlots(client: CalDiyClient, config: Config, db: Database.Database, params: {
    eventTypeSlug: string;
    dateFrom: string;
    dateTo: string;
    requesterEmail?: string;
    requesterDomain?: string;
    requestedPriority?: Priority;
}): Promise<{
    free_slots: FreeSlot[];
    displaceable_slots: DisplacableSlot[];
}>;
/**
 * Build and store a plan. Returns the plan with TTL.
 */
export declare function buildPlan(client: CalDiyClient, config: Config, db: Database.Database, params: {
    eventTypeSlug: string;
    start: string;
    attendeeEmail: string;
    attendeeName: string;
    attendeeTimezone: string;
    requestedPriority?: Priority;
    idempotencyKey?: string;
    conversationId?: string;
}): Promise<Plan>;
/**
 * Execute a previously built plan as a saga (spec §7).
 */
export declare function executePlan(client: CalDiyClient, config: Config, db: Database.Database, planId: string, confirmed?: boolean, notifyOutbox?: NotifyOutbox): Promise<{
    status: "executed" | "approval_required" | "denied";
    result?: unknown;
    approval_id?: string;
}>;
//# sourceMappingURL=index.d.ts.map