/**
 * policy/engine.ts — Pure deterministic policy engine (no I/O)
 */
/**
 * Priority rank: lower number is higher priority.
 */
export const PRIORITY_RANK = {
    CRITICAL: 0,
    HIGH: 1,
    NORMAL: 2,
    LOW: 3,
};
/**
 * Derive priority for a booking request using policy rules.
 * Falls back to policy.default_priority if no rule matches.
 */
export function derivePriority(policy, context) {
    const domain = context.attendeeDomain ||
        (context.attendeeEmail && context.attendeeEmail.includes("@")
            ? context.attendeeEmail.split("@")[1]?.toLowerCase()
            : undefined);
    for (const rule of policy.priority_rules || []) {
        const match = rule.match;
        if (!match)
            continue;
        let isMatch = true;
        if (match.attendee_domain) {
            if (!domain || domain.toLowerCase() !== match.attendee_domain.toLowerCase()) {
                isMatch = false;
            }
        }
        if (isMatch && match.event_type_slug) {
            if (!context.eventTypeSlug || context.eventTypeSlug !== match.event_type_slug) {
                isMatch = false;
            }
        }
        if (isMatch && match.attendee_email) {
            if (!context.attendeeEmail ||
                context.attendeeEmail.toLowerCase() !== match.attendee_email.toLowerCase()) {
                isMatch = false;
            }
        }
        if (isMatch && match.title_regex) {
            if (!context.title) {
                isMatch = false;
            }
            else {
                try {
                    const reg = new RegExp(match.title_regex, "i");
                    if (!reg.test(context.title)) {
                        isMatch = false;
                    }
                }
                catch {
                    isMatch = false;
                }
            }
        }
        if (isMatch) {
            return rule.priority;
        }
    }
    return policy.default_priority || "NORMAL";
}
/**
 * Evaluate whether a requested priority can displace an existing priority.
 * Returns the displacement decision from the matrix, with protection checks.
 */
export function evaluateDisplacement(policy, params) {
    const matrix = policy.displacement?.matrix || {};
    const requestedRow = matrix[params.requestedPriority] || {};
    const baseDecision = requestedRow[params.existingPriority] || "deny";
    if (baseDecision === "deny") {
        return "deny";
    }
    // 1. Notice hours check
    if (params.hoursUntilMeeting !== undefined &&
        params.hoursUntilMeeting < (policy.displacement?.min_notice_hours ?? 24)) {
        return "deny";
    }
    // 2. Reschedule count cap
    if (params.rescheduleCount !== undefined &&
        params.rescheduleCount >= (policy.displacement?.max_reschedules_per_booking ?? 2)) {
        return "deny";
    }
    // 3. Displacements per day cap
    if (params.displacementsToday !== undefined &&
        params.displacementsToday >= (policy.displacement?.max_displacements_per_day ?? 3)) {
        return "deny";
    }
    // 4. External attendee protection
    if (params.hasExternalAttendees &&
        policy.displacement?.protect_external_attendees &&
        baseDecision === "auto") {
        return "approval";
    }
    return baseDecision;
}
/**
 * Apply the autonomy gate (spec §5 §7).
 * Returns whether the action can proceed, needs confirmation, or is suggestion-only.
 */
export function checkAutonomyGate(policy, autonomyLevel, decision, confirmedByHuman = false) {
    if (autonomyLevel === 0) {
        return "suggestion_only";
    }
    if (autonomyLevel === 1) {
        return confirmedByHuman ? "ok" : "needs_confirmation";
    }
    if (decision === "deny") {
        return "suggestion_only";
    }
    // At level 2 or 3, displacement requires human confirmation
    if (autonomyLevel < 4 && decision !== "auto") {
        return confirmedByHuman ? "ok" : "needs_confirmation";
    }
    return "ok";
}
//# sourceMappingURL=engine.js.map