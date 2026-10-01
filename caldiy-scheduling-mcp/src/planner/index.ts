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
import type { Slot, Booking } from "../caldiy/types.js";
import type { Priority } from "../policy/engine.js";

export interface FreeSlot extends Slot {}

export interface DisplacableSlot extends Slot {
  requires: "none" | "approval"; // opaque to public — no owner/title info
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
export async function findSlots(
  _client: CalDiyClient,
  _config: Config,
  _params: {
    eventTypeSlug: string;
    dateFrom: string;
    dateTo: string;
    requesterEmail?: string;
    requesterDomain?: string;
    requestedPriority: Priority;
  }
): Promise<{ free_slots: FreeSlot[]; displaceable_slots: DisplacableSlot[] }> {
  // TODO:
  // 1. GET /slots from Cal.diy → free_slots
  // 2. GET owner bookings for window
  // 3. For each occupied slot, evaluate displacement matrix
  // 4. Return opaque displaceable_slots (no private data)
  throw new Error("Not implemented");
}

/**
 * Build and store a plan. Returns the plan with TTL.
 * All policy checks happen here — planner is the single gate.
 */
export async function buildPlan(
  _client: CalDiyClient,
  _config: Config,
  _params: {
    eventTypeSlug: string;
    start: string;
    attendeeEmail: string;
    attendeeName: string;
    attendeeTimezone: string;
    requestedPriority: Priority;
    idempotencyKey?: string;
  }
): Promise<Plan> {
  // TODO: validate, run policy, store plan in SQLite with TTL
  throw new Error("Not implemented");
}

/**
 * Execute a previously built plan as a saga (spec §7).
 * Re-validates all steps before touching Cal.diy.
 * Compensation runs if a later step fails.
 */
export async function executePlan(
  _client: CalDiyClient,
  _config: Config,
  _planId: string,
  _confirmed?: boolean
): Promise<{ status: "executed" | "approval_required" | "denied"; result?: unknown }> {
  // TODO: reject expired / already executed / hash-changed plans
  // TODO: re-fetch and re-validate every step
  // TODO: saga: reschedule displaced first, then create booking
  // TODO: compensation on partial failure
  throw new Error("Not implemented");
}
