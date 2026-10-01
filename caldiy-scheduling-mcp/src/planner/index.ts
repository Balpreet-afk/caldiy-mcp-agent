/**
 * planner/index.ts — Conflict discovery, displacement & saga orchestration
 */

import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import type { Config, Policy, Priority } from "../config.js";
import type { CalDiyClient } from "../caldiy/client.js";
import type { Slot, Booking, Attendee } from "../caldiy/types.js";
import {
  derivePriority,
  evaluateDisplacement,
  checkAutonomyGate,
  DisplacementDecision,
} from "../policy/engine.js";
import {
  savePlan,
  getPlan,
  getPlanByIdempotencyKey,
  updatePlanStatus,
  createApproval,
  getApprovalByPlanId,
  getStoredPriority,
  setStoredPriority,
  countDisplacementsToday,
  logAudit,
} from "../store/index.js";
import { hashConfig } from "../security/index.js";
import type { NotifyOutbox } from "../notify/index.js";

export interface FreeSlot extends Slot {}

export interface DisplacableSlot extends Slot {
  requires: "none" | "approval"; // opaque to public
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
export async function findSlots(
  client: CalDiyClient,
  config: Config,
  db: Database.Database,
  params: {
    eventTypeSlug: string;
    dateFrom: string;
    dateTo: string;
    requesterEmail?: string;
    requesterDomain?: string;
    requestedPriority?: Priority;
  }
): Promise<{ free_slots: FreeSlot[]; displaceable_slots: DisplacableSlot[] }> {
  // 1. Get free slots from Cal.diy
  const freeSlots = await client.getSlots({
    eventTypeSlug: params.eventTypeSlug,
    startTime: params.dateFrom,
    endTime: params.dateTo,
  });

  // 2. Derive requester priority
  const requesterPriority: Priority =
    params.requestedPriority ||
    derivePriority(config.policy, {
      eventTypeSlug: params.eventTypeSlug,
      attendeeEmail: params.requesterEmail,
      attendeeDomain: params.requesterDomain,
    });

  // 3. Get bookings in window for conflict discovery
  const bookings = await client.getBookings({
    afterStart: params.dateFrom,
    beforeEnd: params.dateTo,
    status: "accepted",
  });

  const displaceable_slots: DisplacableSlot[] = [];
  const displacementsToday = countDisplacementsToday(db);

  // 4. Evaluate displacement for each booking
  for (const booking of bookings) {
    if (booking.status === "cancelled" || booking.status === "rejected") {
      continue;
    }

    // Determine existing priority
    let existingPriority: Priority;
    const stored = getStoredPriority(db, booking.uid);
    if (stored) {
      existingPriority = stored.priority;
    } else {
      existingPriority = derivePriority(config.policy, {
        title: booking.title,
        attendeeEmail: booking.attendees[0]?.email,
      });
      setStoredPriority(db, booking.uid, existingPriority, "rule");
    }

    const hoursUntilMeeting =
      (new Date(booking.start).getTime() - Date.now()) / (1000 * 60 * 60);

    // Check external attendees
    const hasExternalAttendees = (booking.attendees || []).some((a) => {
      const emailDomain = a.email.split("@")[1]?.toLowerCase();
      return emailDomain !== "example.com" && emailDomain !== "cal.diy";
    });

    const decision = evaluateDisplacement(config.policy, {
      requestedPriority: requesterPriority,
      existingPriority,
      hasExternalAttendees,
      hoursUntilMeeting,
      displacementsToday,
    });

    if (decision !== "deny") {
      displaceable_slots.push({
        start: booking.start,
        end: booking.end,
        requires: decision === "auto" ? "none" : "approval",
      });
    }
  }

  return {
    free_slots: freeSlots,
    displaceable_slots,
  };
}

/**
 * Build and store a plan. Returns the plan with TTL.
 */
export async function buildPlan(
  client: CalDiyClient,
  config: Config,
  db: Database.Database,
  params: {
    eventTypeSlug: string;
    start: string;
    attendeeEmail: string;
    attendeeName: string;
    attendeeTimezone: string;
    requestedPriority?: Priority;
    idempotencyKey?: string;
    conversationId?: string;
  }
): Promise<Plan> {
  // Check idempotency
  if (params.idempotencyKey) {
    const existing = getPlanByIdempotencyKey(db, params.idempotencyKey);
    if (existing) {
      const steps = JSON.parse(existing.steps_json) as PlanStep[];
      const policy = JSON.parse(existing.policy_json) as PlanPolicyInfo;
      const approval = getApprovalByPlanId(db, existing.plan_id);
      return {
        plan_id: existing.plan_id,
        expires_at: existing.expires_at,
        steps,
        policy,
        autonomy_gate: "ok",
        approval_id: approval?.approval_id,
      };
    }
  }

  // 1. Get event type details
  const eventTypes = await client.getEventTypes();
  const eventType =
    eventTypes.find((e) => e.slug === params.eventTypeSlug) || eventTypes[0];
  const duration = eventType?.length || 30;
  const startDate = new Date(params.start);
  const endDate = new Date(startDate.getTime() + duration * 60 * 1000);

  // 2. Derive requester priority
  const requesterPriority: Priority =
    params.requestedPriority ||
    derivePriority(config.policy, {
      eventTypeSlug: params.eventTypeSlug,
      attendeeEmail: params.attendeeEmail,
    });

  // 3. Check for conflict in the requested slot
  const bookings = await client.getBookings({
    afterStart: new Date(startDate.getTime() - 60 * 1000).toISOString(),
    beforeEnd: new Date(endDate.getTime() + 60 * 1000).toISOString(),
    status: "accepted",
  });

  const conflictingBooking = bookings.find((b) => {
    if (b.status === "cancelled" || b.status === "rejected") return false;
    const bStart = new Date(b.start).getTime();
    const bEnd = new Date(b.end).getTime();
    return bStart < endDate.getTime() && bEnd > startDate.getTime();
  });

  const planId = `pln_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  const expiresAt = new Date(
    Date.now() + (config.policy.plan_ttl_minutes || 5) * 60 * 1000
  ).toISOString();
  const configHash = hashConfig(config.policy);

  let steps: PlanStep[] = [];
  let policyDecision: PlanPolicyInfo;
  let autonomyGate: "ok" | "needs_confirmation" | "suggestion_only";
  let approvalId: string | undefined;

  const newBookingStep: PlanStep = {
    op: "book",
    eventTypeSlug: params.eventTypeSlug,
    eventTypeId: eventType?.id || 1,
    start: startDate.toISOString(),
    end: endDate.toISOString(),
    attendee: {
      name: params.attendeeName,
      email: params.attendeeEmail,
      timeZone: params.attendeeTimezone,
    },
    metadata: {
      priority: requesterPriority,
      plan_id: planId,
    },
  };

  if (!conflictingBooking) {
    // Free slot -> direct booking
    steps = [newBookingStep];
    policyDecision = {
      decision: "auto",
      rule: "Free slot booking",
      reasons: ["Requested slot is free"],
    };
    autonomyGate = checkAutonomyGate(config.policy, config.policy.autonomy_level, "auto");
  } else {
    // Conflict detected -> evaluate displacement
    let existingPriority: Priority;
    const stored = getStoredPriority(db, conflictingBooking.uid);
    if (stored) {
      existingPriority = stored.priority;
    } else {
      existingPriority = derivePriority(config.policy, {
        title: conflictingBooking.title,
        attendeeEmail: conflictingBooking.attendees[0]?.email,
      });
      setStoredPriority(db, conflictingBooking.uid, existingPriority, "rule");
    }

    const hoursUntilMeeting =
      (new Date(conflictingBooking.start).getTime() - Date.now()) / (1000 * 60 * 60);

    const hasExternalAttendees = (conflictingBooking.attendees || []).some((a) => {
      const emailDomain = a.email.split("@")[1]?.toLowerCase();
      return emailDomain !== "example.com" && emailDomain !== "cal.diy";
    });

    const displacementsToday = countDisplacementsToday(db);

    const dispDecision = evaluateDisplacement(config.policy, {
      requestedPriority: requesterPriority,
      existingPriority,
      hasExternalAttendees,
      hoursUntilMeeting,
      displacementsToday,
    });

    if (dispDecision === "deny") {
      policyDecision = {
        decision: "denied",
        rule: `${requesterPriority}>${existingPriority} deny`,
        reasons: ["Target meeting cannot be displaced under policy rules"],
      };
      autonomyGate = "suggestion_only";
      steps = [];
    } else {
      // Find alt slot for displaced meeting
      const altSearchStart = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
      const altSearchEnd = new Date(
        Date.now() + (config.policy.displacement.alt_slot_search_days || 7) * 24 * 3600 * 1000
      ).toISOString();

      const availableSlots = await client.getSlots({
        startTime: altSearchStart,
        endTime: altSearchEnd,
        eventTypeId: conflictingBooking.eventTypeId,
        duration: duration,
      });

      const altSlot = availableSlots[0];
      if (!altSlot) {
        policyDecision = {
          decision: "denied",
          rule: "no_alternative_slot",
          reasons: ["No alternative slot found for displaced meeting within search window"],
        };
        autonomyGate = "suggestion_only";
        steps = [];
      } else {
        steps = [
          {
            op: "reschedule",
            bookingRef: conflictingBooking.uid,
            originalStart: conflictingBooking.start,
            to: altSlot.start,
          },
          newBookingStep,
        ];

        const mappedDecision: "auto" | "approval_required" =
          dispDecision === "auto" ? "auto" : "approval_required";

        policyDecision = {
          decision: mappedDecision,
          rule: `${requesterPriority}>${existingPriority} ${dispDecision}`,
          reasons: [
            `Displacing booking ${conflictingBooking.uid} (${existingPriority}) with ${requesterPriority} request`,
          ],
        };

        autonomyGate = checkAutonomyGate(
          config.policy,
          config.policy.autonomy_level,
          dispDecision
        );
      }
    }
  }

  savePlan(db, {
    plan_id: planId,
    expires_at: expiresAt,
    steps_json: JSON.stringify(steps),
    policy_json: JSON.stringify(policyDecision),
    config_hash: configHash,
    idempotency_key: params.idempotencyKey,
  });

  if (policyDecision.decision === "approval_required") {
    const appr = createApproval(
      db,
      planId,
      configHash,
      config.policy.approval_ttl_minutes
    );
    approvalId = appr.approval_id;
  }

  return {
    plan_id: planId,
    expires_at: expiresAt,
    steps,
    policy: policyDecision,
    autonomy_gate: autonomyGate,
    approval_id: approvalId,
  };
}

/**
 * Execute a previously built plan as a saga (spec §7).
 */
export async function executePlan(
  client: CalDiyClient,
  config: Config,
  db: Database.Database,
  planId: string,
  confirmed = false,
  notifyOutbox?: NotifyOutbox
): Promise<{
  status: "executed" | "approval_required" | "denied";
  result?: unknown;
  approval_id?: string;
}> {
  const planRow = getPlan(db, planId);
  if (!planRow) {
    return {
      status: "denied",
      result: { error: `Plan '${planId}' not found` },
    };
  }

  if (planRow.status === "executed") {
    return {
      status: "executed",
      result: { message: "Plan already executed" },
    };
  }

  if (new Date(planRow.expires_at).getTime() < Date.now()) {
    updatePlanStatus(db, planId, "expired");
    return {
      status: "denied",
      result: { error: "Plan expired" },
    };
  }

  const currentConfigHash = hashConfig(config.policy);
  if (planRow.config_hash !== currentConfigHash) {
    return {
      status: "denied",
      result: { error: "Policy configuration changed since plan was created" },
    };
  }

  const steps = JSON.parse(planRow.steps_json) as PlanStep[];
  const policyInfo = JSON.parse(planRow.policy_json) as PlanPolicyInfo;

  if (policyInfo.decision === "denied") {
    return {
      status: "denied",
      result: { reasons: policyInfo.reasons },
    };
  }

  // Check approval if required
  if (policyInfo.decision === "approval_required") {
    const approval = getApprovalByPlanId(db, planId);
    if (!approval || approval.status !== "approved") {
      return {
        status: "approval_required",
        approval_id: approval?.approval_id,
        result: { message: "Owner approval required before execution" },
      };
    }
  }

  // Check autonomy gate confirmation
  if (config.policy.autonomy_level === 1 && !confirmed) {
    return {
      status: "denied",
      result: { message: "Action requires confirmation under autonomy_level=1" },
    };
  }

  if (config.DRY_RUN) {
    updatePlanStatus(db, planId, "executed");
    logAudit(db, {
      profile: config.MCP_PROFILE,
      tool: "execute_plan",
      action_type: "dry_run_execution",
      plan_id: planId,
      status: "success",
      dry_run: true,
    });
    return {
      status: "executed",
      result: { dry_run: true, steps },
    };
  }

  // Saga execution with compensation
  const executedSteps: PlanStep[] = [];
  let finalBooking: Booking | undefined;

  try {
    for (const step of steps) {
      if (step.op === "reschedule" && step.bookingRef && step.to) {
        // Re-validate booking before reschedule
        const existing = await client.getBooking(step.bookingRef);
        if (!existing || existing.status === "cancelled") {
          throw new Error(`Target booking ${step.bookingRef} is no longer available`);
        }

        await client.rescheduleBooking(step.bookingRef, {
          start: step.to,
          reschedulingReason: "Rescheduled by scheduling policy",
        });
        executedSteps.push(step);

        logAudit(db, {
          profile: config.MCP_PROFILE,
          tool: "execute_plan",
          action_type: "displacement",
          booking_uid: step.bookingRef,
          plan_id: planId,
          old_value: step.originalStart,
          new_value: step.to,
          policy_decision: policyInfo.decision,
          policy_rule: policyInfo.rule,
          status: "success",
        });

        if (notifyOutbox) {
          notifyOutbox.enqueue({
            type: "displacement",
            ts: new Date().toISOString(),
            summary: `Displaced booking ${step.bookingRef} to ${step.to}`,
            plan_id: planId,
            booking_uids: [step.bookingRef],
          });
        }
      } else if (step.op === "book" && step.start && step.attendee) {
        finalBooking = await client.createBooking({
          start: step.start,
          eventTypeId: step.eventTypeId || 1,
          attendee: step.attendee,
          metadata: step.metadata,
        });
        executedSteps.push(step);

        if (finalBooking?.uid) {
          const priority = (step.metadata?.priority as Priority) || "NORMAL";
          setStoredPriority(db, finalBooking.uid, priority, "rule");
        }
      }
    }

    updatePlanStatus(db, planId, "executed");

    logAudit(db, {
      profile: config.MCP_PROFILE,
      tool: "execute_plan",
      action_type: "book",
      booking_uid: finalBooking?.uid,
      plan_id: planId,
      policy_decision: policyInfo.decision,
      status: "success",
    });

    if (notifyOutbox) {
      notifyOutbox.enqueue({
        type: "plan_executed",
        ts: new Date().toISOString(),
        summary: `Plan ${planId} executed successfully`,
        plan_id: planId,
        booking_uids: finalBooking ? [finalBooking.uid] : [],
      });
    }

    return {
      status: "executed",
      result: finalBooking || { steps: executedSteps },
    };
  } catch (err: unknown) {
    // Compensation on failure
    console.error(`Saga failed during plan ${planId}, running compensation:`, err);
    updatePlanStatus(db, planId, "cancelled");

    for (const step of executedSteps) {
      if (step.op === "reschedule" && step.bookingRef && step.originalStart) {
        try {
          await client.rescheduleBooking(step.bookingRef, {
            start: step.originalStart,
            reschedulingReason: "Compensation: rollback after booking failure",
          });
          logAudit(db, {
            profile: config.MCP_PROFILE,
            tool: "execute_plan",
            action_type: "compensation",
            booking_uid: step.bookingRef,
            plan_id: planId,
            status: "success",
          });
        } catch (compErr) {
          console.error(`Compensation failed for ${step.bookingRef}:`, compErr);
        }
      }
    }

    logAudit(db, {
      profile: config.MCP_PROFILE,
      tool: "execute_plan",
      action_type: "execution_failure",
      plan_id: planId,
      status: "error",
      error: (err as Error).message,
    });

    return {
      status: "denied",
      result: { error: `Plan execution failed: ${(err as Error).message}` },
    };
  }
}
