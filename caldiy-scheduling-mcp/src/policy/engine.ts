/**
 * policy/engine.ts — Pure deterministic policy engine (no I/O)
 *
 * Responsibilities:
 *  - Derive priority from rules (spec §4)
 *  - Evaluate displacement matrix (spec §5)
 *  - Apply autonomy gate (spec §5 §7)
 *  - All functions are pure; side effects belong in planner/ or store/
 */

import type { Policy, Priority } from "../config.js";

// Re-export priority type so rest of codebase imports from one place
export type { Priority } from "../config.js";

export type DisplacementDecision = "auto" | "approval" | "deny";

export interface PolicyDecision {
  decision: "auto" | "approval_required" | "denied" | "suggestion_only";
  rule: string;
  reasons: string[];
}

/**
 * Derive priority for a booking request using policy rules.
 * Falls back to policy.default_priority if no rule matches.
 */
export function derivePriority(
  _policy: Policy,
  _context: {
    eventTypeSlug?: string;
    attendeeEmail?: string;
    attendeeDomain?: string;
    titleRegex?: string;
  }
): Priority {
  // TODO: walk priority_rules in order, first match wins
  throw new Error("Not implemented");
}

/**
 * Evaluate whether a requested priority can displace an existing priority.
 * Returns the displacement decision from the matrix, with protection checks.
 */
export function evaluateDisplacement(
  _policy: Policy,
  _params: {
    requestedPriority: Priority;
    existingPriority: Priority;
    hasExternalAttendees: boolean;
    rescheduleCount: number;
    hoursUntilMeeting: number;
    displacementsToday: number;
  }
): DisplacementDecision {
  // TODO: check matrix, then apply protection overrides (min_notice, external attendees, caps)
  throw new Error("Not implemented");
}

/**
 * Apply the autonomy gate (spec §5 §7).
 * Returns whether the action can proceed, needs confirmation, or is suggestion-only.
 */
export function checkAutonomyGate(
  _policy: Policy,
  _autonomyLevel: number,
  _decision: DisplacementDecision,
  _confirmedByHuman: boolean
): PolicyDecision["decision"] {
  // TODO: level 0 → suggestion_only; level 1 → needs_confirmation; 2+ → auto / per matrix
  throw new Error("Not implemented");
}
