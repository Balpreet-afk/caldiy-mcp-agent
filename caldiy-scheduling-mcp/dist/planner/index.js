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
/**
 * Discover free and displaceable slots for a given event type and date range.
 * displaceable_slots are opaque — never include booking owner/title details.
 */
export async function findSlots(_client, _config, _params) {
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
export async function buildPlan(_client, _config, _params) {
    // TODO: validate, run policy, store plan in SQLite with TTL
    throw new Error("Not implemented");
}
/**
 * Execute a previously built plan as a saga (spec §7).
 * Re-validates all steps before touching Cal.diy.
 * Compensation runs if a later step fails.
 */
export async function executePlan(_client, _config, _planId, _confirmed) {
    // TODO: reject expired / already executed / hash-changed plans
    // TODO: re-fetch and re-validate every step
    // TODO: saga: reschedule displaced first, then create booking
    // TODO: compensation on partial failure
    throw new Error("Not implemented");
}
//# sourceMappingURL=index.js.map