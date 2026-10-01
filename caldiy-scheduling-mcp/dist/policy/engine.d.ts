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
export declare function derivePriority(_policy: Policy, _context: {
    eventTypeSlug?: string;
    attendeeEmail?: string;
    attendeeDomain?: string;
    titleRegex?: string;
}): Priority;
/**
 * Evaluate whether a requested priority can displace an existing priority.
 * Returns the displacement decision from the matrix, with protection checks.
 */
export declare function evaluateDisplacement(_policy: Policy, _params: {
    requestedPriority: Priority;
    existingPriority: Priority;
    hasExternalAttendees: boolean;
    rescheduleCount: number;
    hoursUntilMeeting: number;
    displacementsToday: number;
}): DisplacementDecision;
/**
 * Apply the autonomy gate (spec §5 §7).
 * Returns whether the action can proceed, needs confirmation, or is suggestion-only.
 */
export declare function checkAutonomyGate(_policy: Policy, _autonomyLevel: number, _decision: DisplacementDecision, _confirmedByHuman: boolean): PolicyDecision["decision"];
//# sourceMappingURL=engine.d.ts.map