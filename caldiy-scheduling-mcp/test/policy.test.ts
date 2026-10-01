import { describe, it, expect } from "vitest";
import {
  derivePriority,
  evaluateDisplacement,
  checkAutonomyGate,
  Priority,
} from "../src/policy/engine.js";
import type { Policy } from "../src/config.js";

const samplePolicy: Policy = {
  autonomy_level: 3,
  timezone: "Asia/Kolkata",
  working_hours: { "mon-fri": ["10:00-18:00"] },
  default_priority: "NORMAL",
  priority_rules: [
    { match: { attendee_domain: "kodev.studio" }, priority: "LOW" },
    { match: { event_type_slug: "client-call" }, priority: "HIGH" },
    { match: { attendee_email: "vip@important.com" }, priority: "CRITICAL" },
    { match: { title_regex: "Board Meeting" }, priority: "CRITICAL" },
  ],
  displacement: {
    matrix: {
      HIGH: { LOW: "auto", NORMAL: "approval", HIGH: "deny", CRITICAL: "deny" },
      CRITICAL: { LOW: "auto", NORMAL: "approval", HIGH: "approval", CRITICAL: "deny" },
      NORMAL: { LOW: "approval", NORMAL: "deny", HIGH: "deny", CRITICAL: "deny" },
      LOW: { LOW: "deny", NORMAL: "deny", HIGH: "deny", CRITICAL: "deny" },
    },
    max_displacements_per_plan: 1,
    max_displacements_per_day: 3,
    min_notice_hours: 24,
    protect_external_attendees: true,
    max_reschedules_per_booking: 2,
    alt_slot_search_days: 7,
    alt_slot_strategy: "earliest",
  },
  cancel: "deny",
  public: {
    expose_titles: false,
    allow_self_reschedule: true,
    allow_self_cancel: true,
  },
  limits: {
    tool_calls_per_minute: 30,
    bookings_per_day_per_attendee: 3,
  },
  approval_ttl_minutes: 60,
  plan_ttl_minutes: 5,
};

describe("Policy Engine", () => {
  describe("derivePriority", () => {
    it("matches attendee domain", () => {
      const p = derivePriority(samplePolicy, { attendeeEmail: "dev@kodev.studio" });
      expect(p).toBe("LOW");
    });

    it("matches event type slug", () => {
      const p = derivePriority(samplePolicy, { eventTypeSlug: "client-call" });
      expect(p).toBe("HIGH");
    });

    it("matches attendee email exact", () => {
      const p = derivePriority(samplePolicy, { attendeeEmail: "vip@important.com" });
      expect(p).toBe("CRITICAL");
    });

    it("matches title regex", () => {
      const p = derivePriority(samplePolicy, { title: "Annual Board Meeting 2026" });
      expect(p).toBe("CRITICAL");
    });

    it("respects rule order (first match wins)", () => {
      const p = derivePriority(samplePolicy, {
        attendeeEmail: "alice@kodev.studio",
        eventTypeSlug: "client-call",
      });
      expect(p).toBe("LOW");
    });

    it("falls back to default priority", () => {
      const p = derivePriority(samplePolicy, { attendeeEmail: "someone@random.com" });
      expect(p).toBe("NORMAL");
    });
  });

  describe("evaluateDisplacement matrix & protections", () => {
    it("HIGH displacing LOW is auto", () => {
      const decision = evaluateDisplacement(samplePolicy, {
        requestedPriority: "HIGH",
        existingPriority: "LOW",
        hasExternalAttendees: false,
        rescheduleCount: 0,
        hoursUntilMeeting: 48,
        displacementsToday: 0,
      });
      expect(decision).toBe("auto");
    });

    it("HIGH displacing NORMAL is approval", () => {
      const decision = evaluateDisplacement(samplePolicy, {
        requestedPriority: "HIGH",
        existingPriority: "NORMAL",
        hasExternalAttendees: false,
        rescheduleCount: 0,
        hoursUntilMeeting: 48,
        displacementsToday: 0,
      });
      expect(decision).toBe("approval");
    });

    it("HIGH displacing CRITICAL is denied", () => {
      const decision = evaluateDisplacement(samplePolicy, {
        requestedPriority: "HIGH",
        existingPriority: "CRITICAL",
        hasExternalAttendees: false,
        rescheduleCount: 0,
        hoursUntilMeeting: 48,
        displacementsToday: 0,
      });
      expect(decision).toBe("deny");
    });

    it("protects external attendees by elevating auto to approval", () => {
      const decision = evaluateDisplacement(samplePolicy, {
        requestedPriority: "HIGH",
        existingPriority: "LOW",
        hasExternalAttendees: true,
        rescheduleCount: 0,
        hoursUntilMeeting: 48,
        displacementsToday: 0,
      });
      expect(decision).toBe("approval");
    });

    it("denies displacement if notice is less than min_notice_hours (24h)", () => {
      const decision = evaluateDisplacement(samplePolicy, {
        requestedPriority: "HIGH",
        existingPriority: "LOW",
        hasExternalAttendees: false,
        rescheduleCount: 0,
        hoursUntilMeeting: 12,
        displacementsToday: 0,
      });
      expect(decision).toBe("deny");
    });

    it("denies displacement if reschedule count reaches max", () => {
      const decision = evaluateDisplacement(samplePolicy, {
        requestedPriority: "HIGH",
        existingPriority: "LOW",
        hasExternalAttendees: false,
        rescheduleCount: 2,
        hoursUntilMeeting: 48,
        displacementsToday: 0,
      });
      expect(decision).toBe("deny");
    });

    it("denies displacement if daily displacement limit reached", () => {
      const decision = evaluateDisplacement(samplePolicy, {
        requestedPriority: "HIGH",
        existingPriority: "LOW",
        hasExternalAttendees: false,
        rescheduleCount: 0,
        hoursUntilMeeting: 48,
        displacementsToday: 3,
      });
      expect(decision).toBe("deny");
    });
  });

  describe("checkAutonomyGate", () => {
    it("level 0 is always suggestion_only", () => {
      expect(checkAutonomyGate(samplePolicy, 0, "auto", true)).toBe("suggestion_only");
      expect(checkAutonomyGate(samplePolicy, 0, "approval", true)).toBe("suggestion_only");
    });

    it("level 1 requires confirmation", () => {
      expect(checkAutonomyGate(samplePolicy, 1, "auto", false)).toBe("needs_confirmation");
      expect(checkAutonomyGate(samplePolicy, 1, "auto", true)).toBe("ok");
    });

    it("level 2/3 allows auto directly", () => {
      expect(checkAutonomyGate(samplePolicy, 3, "auto", false)).toBe("ok");
    });

    it("level 2/3 with approval decision requires confirmation", () => {
      expect(checkAutonomyGate(samplePolicy, 3, "approval", false)).toBe("needs_confirmation");
      expect(checkAutonomyGate(samplePolicy, 3, "approval", true)).toBe("ok");
    });

    it("level 4 allows auto", () => {
      expect(checkAutonomyGate(samplePolicy, 4, "auto", false)).toBe("ok");
    });
  });
});
