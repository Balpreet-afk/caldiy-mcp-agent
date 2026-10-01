import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadConfig } from "../src/config.js";
import { writeFileSync, unlinkSync } from "node:fs";

const originalEnv = { ...process.env };
const TEST_POLICY_PATH = "./test-policy.yaml";

const validPolicyYaml = `
autonomy_level: 3
timezone: Asia/Kolkata
working_hours:
  mon-fri: ["10:00-18:00"]
default_priority: NORMAL
priority_rules:
  - match: { attendee_domain: "kodev.studio" }
    priority: LOW
displacement:
  matrix:
    HIGH: { LOW: auto, NORMAL: approval, HIGH: deny, CRITICAL: deny }
    CRITICAL: { LOW: auto, NORMAL: approval, HIGH: approval, CRITICAL: deny }
    NORMAL: { LOW: approval }
    LOW: {}
  max_displacements_per_plan: 1
  max_displacements_per_day: 3
  min_notice_hours: 24
  protect_external_attendees: true
  max_reschedules_per_booking: 2
  alt_slot_search_days: 7
  alt_slot_strategy: earliest
cancel: deny
public:
  expose_titles: false
  allow_self_reschedule: true
  allow_self_cancel: true
limits:
  tool_calls_per_minute: 30
  bookings_per_day_per_attendee: 3
approval_ttl_minutes: 60
plan_ttl_minutes: 5
`;

beforeEach(() => {
  writeFileSync(TEST_POLICY_PATH, validPolicyYaml);
  process.env = {
    ...originalEnv,
    CAL_API_URL: "http://localhost:5555",
    CAL_API_KEY: "cal_test_123",
    MCP_PROFILE: "public",
    POLICY_FILE: TEST_POLICY_PATH,
  };
});

afterEach(() => {
  try {
    unlinkSync(TEST_POLICY_PATH);
  } catch {}
  process.env = { ...originalEnv };
});

describe("Config Loader", () => {
  it("loads valid configuration and policy", () => {
    const config = loadConfig();
    expect(config.CAL_API_URL).toBe("http://localhost:5555");
    expect(config.CAL_API_KEY).toBe("cal_test_123");
    expect(config.MCP_PROFILE).toBe("public");
    expect(config.policy.autonomy_level).toBe(3);
    expect(config.policy.default_priority).toBe("NORMAL");
  });

  it("fails fast when required env is missing", () => {
    delete process.env.CAL_API_KEY;
    expect(() => loadConfig()).toThrow();
  });

  it("fails when MCP_TRANSPORT=http without bearer token", () => {
    process.env.MCP_TRANSPORT = "http";
    delete process.env.MCP_HTTP_BEARER_TOKEN;
    expect(() => loadConfig()).toThrow("MCP_HTTP_BEARER_TOKEN is required");
  });

  it("fails when policy schema is invalid", () => {
    writeFileSync(TEST_POLICY_PATH, "autonomy_level: 99\n");
    expect(() => loadConfig()).toThrow();
  });
});
