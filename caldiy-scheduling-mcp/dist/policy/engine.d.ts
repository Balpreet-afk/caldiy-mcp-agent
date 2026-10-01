/**
 * policy/engine.ts — Pure deterministic policy engine (no I/O)
 */
import type { Policy, Priority } from "../config.js";
export type { Priority } from "../config.js";
export type DisplacementDecision = "auto" | "approval" | "deny";
export interface PolicyDecision {
    decision: "auto" | "approval_required" | "denied" | "suggestion_only";
    rule: string;
    reasons: string[];
}
export interface MatchContext {
    eventTypeSlug?: string;
    attendeeEmail?: string;
    attendeeDomain?: string;
    title?: string;
}
export interface DisplacementParams {
    requestedPriority: Priority;
    existingPriority: Priority;
    hasExternalAttendees?: boolean;
    rescheduleCount?: number;
    hoursUntilMeeting?: number;
    displacementsToday?: number;
}
/**
 * Priority rank: lower number is higher priority.
 */
export declare const PRIORITY_RANK: Record<Priority, number>;
/**
 * Derive priority for a booking request using policy rules.
 * Falls back to policy.default_priority if no rule matches.
 */
export declare function derivePriority(policy: Policy, context: MatchContext): Priority;
/**
 * Evaluate whether a requested priority can displace an existing priority.
 * Returns the displacement decision from the matrix, with protection checks.
 */
export declare function evaluateDisplacement(policy: Policy, params: DisplacementParams): DisplacementDecision;
/**
 * Apply the autonomy gate (spec §5 §7).
 * Returns whether the action can proceed, needs confirmation, or is suggestion-only.
 */
export declare function checkAutonomyGate(policy: Policy, autonomyLevel: number, decision: DisplacementDecision, confirmedByHuman?: boolean): "ok" | "needs_confirmation" | "suggestion_only";
//# sourceMappingURL=engine.d.ts.map