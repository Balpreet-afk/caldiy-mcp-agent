import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { CalDiyClient } from "../src/caldiy/client.js";
import { findSlots, buildPlan, executePlan } from "../src/planner/index.js";
import { openStore, updateApprovalStatus } from "../src/store/index.js";
import type { Config } from "../src/config.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CAL_API_URL = "http://localhost:5555";
const CAL_API_KEY = "cal_test_12345";

let tempDir: string;
let db: any;

let bookingsStore: any[] = [];
let failOnCreate = false;

const server = setupServer(
  http.get(`${CAL_API_URL}/v2/event-types`, () => {
    return HttpResponse.json({
      status: "success",
      data: [{ id: 1, title: "30 Min Chat", slug: "30min", length: 30 }],
    });
  }),

  http.get(`${CAL_API_URL}/v2/slots`, () => {
    return HttpResponse.json({
      status: "success",
      data: {
        slots: {
          "2026-10-02": [
            { time: "2026-10-02T10:00:00.000Z" },
            { time: "2026-10-02T11:00:00.000Z" },
          ],
        },
      },
    });
  }),

  http.get(`${CAL_API_URL}/v2/bookings`, () => {
    return HttpResponse.json({
      status: "success",
      data: bookingsStore,
    });
  }),

  http.get(`${CAL_API_URL}/v2/bookings/:uid`, ({ params }) => {
    const b = bookingsStore.find((item) => item.uid === params.uid);
    if (!b) return HttpResponse.json({ error: { message: "Not found" } }, { status: 404 });
    return HttpResponse.json({ status: "success", data: b });
  }),

  http.post(`${CAL_API_URL}/v2/bookings`, async ({ request }) => {
    if (failOnCreate) {
      return HttpResponse.json({ error: { message: "Upstream booking creation failed" } }, { status: 500 });
    }
    const body = (await request.json()) as any;
    const newB = {
      id: 999,
      uid: "bkg_new_999",
      title: "New Booking",
      start: body.start,
      end: new Date(new Date(body.start).getTime() + 30 * 60000).toISOString(),
      status: "accepted",
      eventTypeId: body.eventTypeId,
      attendees: [body.attendee],
      metadata: body.metadata,
    };
    bookingsStore.push(newB);
    return HttpResponse.json({ status: "success", data: newB }, { status: 201 });
  }),

  http.post(`${CAL_API_URL}/v2/bookings/:uid/reschedule`, async ({ params, request }) => {
    const body = (await request.json()) as any;
    const b = bookingsStore.find((item) => item.uid === params.uid);
    if (!b) return HttpResponse.json({ error: { message: "Not found" } }, { status: 404 });
    b.start = body.start;
    return HttpResponse.json({ status: "success", data: b });
  })
);

beforeAll(() => server.listen());
afterAll(() => server.close());

afterEach(() => {
  server.resetHandlers();
  failOnCreate = false;
  try {
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  } catch {}
});

function getTestConfig(): Config {
  tempDir = mkdtempSync(join(tmpdir(), "mcp-test-"));
  db = openStore(tempDir);

  return {
    CAL_API_URL,
    CAL_API_KEY,
    MCP_PROFILE: "public",
    MCP_TRANSPORT: "stdio",
    MCP_HTTP_PORT: 3333,
    POLICY_FILE: "./policy.yaml",
    DATA_DIR: tempDir,
    DRY_RUN: false,
    policy: {
      autonomy_level: 4,
      timezone: "Asia/Kolkata",
      working_hours: { "mon-fri": ["10:00-18:00"] },
      default_priority: "NORMAL",
      priority_rules: [
        { match: { attendee_domain: "kodev.studio" }, priority: "LOW" },
        { match: { event_type_slug: "client-call" }, priority: "HIGH" },
        { match: { attendee_email: "vip@important.com" }, priority: "CRITICAL" },
      ],
      displacement: {
        matrix: {
          HIGH: { LOW: "auto", NORMAL: "approval", HIGH: "deny", CRITICAL: "deny" },
          CRITICAL: { LOW: "auto", NORMAL: "approval", HIGH: "approval", CRITICAL: "deny" },
          NORMAL: { LOW: "approval" },
          LOW: {},
        },
        max_displacements_per_plan: 1,
        max_displacements_per_day: 3,
        min_notice_hours: 24,
        protect_external_attendees: false,
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
    },
  };
}

describe("Planner & Saga", () => {
  it("finds free slots and displaceable slots", async () => {
    const config = getTestConfig();
    const client = new CalDiyClient(config);

    bookingsStore = [
      {
        id: 101,
        uid: "bkg_low_01",
        title: "Internal sync",
        start: new Date(Date.now() + 48 * 3600 * 1000).toISOString(),
        end: new Date(Date.now() + 48.5 * 3600 * 1000).toISOString(),
        status: "accepted",
        eventTypeId: 1,
        attendees: [{ name: "Dev", email: "dev@kodev.studio", timeZone: "Asia/Kolkata" }],
      },
    ];

    const result = await findSlots(client, config, db, {
      eventTypeSlug: "client-call",
      dateFrom: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
      dateTo: new Date(Date.now() + 72 * 3600 * 1000).toISOString(),
    });

    expect(result.free_slots).toBeDefined();
    expect(result.displaceable_slots.length).toBe(1);
    expect(result.displaceable_slots[0].requires).toBe("none"); // auto -> none
  });

  it("builds and executes free-slot booking plan", async () => {
    const config = getTestConfig();
    const client = new CalDiyClient(config);
    bookingsStore = [];

    const plan = await buildPlan(client, config, db, {
      eventTypeSlug: "30min",
      start: "2026-10-02T10:00:00.000Z",
      attendeeEmail: "client@example.com",
      attendeeName: "Client",
      attendeeTimezone: "Asia/Kolkata",
    });

    expect(plan.policy.decision).toBe("auto");
    expect(plan.steps).toHaveLength(1);
    expect(plan.steps[0].op).toBe("book");

    const execResult = await executePlan(client, config, db, plan.plan_id);
    expect(execResult.status).toBe("executed");
    expect((execResult.result as any).uid).toBe("bkg_new_999");
  });

  it("builds and executes auto-displacement saga", async () => {
    const config = getTestConfig();
    const client = new CalDiyClient(config);

    const conflictStart = new Date(Date.now() + 48 * 3600 * 1000).toISOString();
    const conflictEnd = new Date(Date.now() + 48.5 * 3600 * 1000).toISOString();

    bookingsStore = [
      {
        id: 101,
        uid: "bkg_low_01",
        title: "Internal sync",
        start: conflictStart,
        end: conflictEnd,
        status: "accepted",
        eventTypeId: 1,
        attendees: [{ name: "Dev", email: "dev@kodev.studio", timeZone: "Asia/Kolkata" }],
      },
    ];

    // Requesting client-call (HIGH priority) over LOW meeting
    const plan = await buildPlan(client, config, db, {
      eventTypeSlug: "client-call",
      start: conflictStart,
      attendeeEmail: "vip-client@company.com",
      attendeeName: "VIP Client",
      attendeeTimezone: "Asia/Kolkata",
    });

    expect(plan.policy.decision).toBe("auto");
    expect(plan.steps).toHaveLength(2);
    expect(plan.steps[0].op).toBe("reschedule");
    expect(plan.steps[1].op).toBe("book");

    const execResult = await executePlan(client, config, db, plan.plan_id);
    expect(execResult.status).toBe("executed");
    expect(bookingsStore[0].start).not.toBe(conflictStart);
  });

  it("blocks execution when approval is required until owner approves", async () => {
    const config = getTestConfig();
    const client = new CalDiyClient(config);

    const conflictStart = new Date(Date.now() + 48 * 3600 * 1000).toISOString();

    // Normal meeting target
    bookingsStore = [
      {
        id: 102,
        uid: "bkg_normal_02",
        title: "Normal Meeting",
        start: conflictStart,
        end: new Date(Date.now() + 48.5 * 3600 * 1000).toISOString(),
        status: "accepted",
        eventTypeId: 1,
        attendees: [{ name: "User", email: "user@example.com", timeZone: "Asia/Kolkata" }],
      },
    ];

    // HIGH displacing NORMAL -> approval required
    const plan = await buildPlan(client, config, db, {
      eventTypeSlug: "client-call",
      start: conflictStart,
      attendeeEmail: "client@test.com",
      attendeeName: "Client",
      attendeeTimezone: "Asia/Kolkata",
    });

    expect(plan.policy.decision).toBe("approval_required");
    expect(plan.approval_id).toBeDefined();

    // First attempt to execute without approval -> blocked
    const exec1 = await executePlan(client, config, db, plan.plan_id);
    expect(exec1.status).toBe("approval_required");

    // Owner approves action
    updateApprovalStatus(db, plan.approval_id!, "approved");

    // Second attempt -> executed
    const exec2 = await executePlan(client, config, db, plan.plan_id);
    expect(exec2.status).toBe("executed");
  });

  it("runs compensation when step 2 fails", async () => {
    const config = getTestConfig();
    const client = new CalDiyClient(config);

    const conflictStart = new Date(Date.now() + 48 * 3600 * 1000).toISOString();

    bookingsStore = [
      {
        id: 101,
        uid: "bkg_low_01",
        title: "Internal sync",
        start: conflictStart,
        end: new Date(Date.now() + 48.5 * 3600 * 1000).toISOString(),
        status: "accepted",
        eventTypeId: 1,
        attendees: [{ name: "Dev", email: "dev@kodev.studio", timeZone: "Asia/Kolkata" }],
      },
    ];

    const plan = await buildPlan(client, config, db, {
      eventTypeSlug: "client-call",
      start: conflictStart,
      attendeeEmail: "client@test.com",
      attendeeName: "Client",
      attendeeTimezone: "Asia/Kolkata",
    });

    // Make createBooking fail
    failOnCreate = true;

    const execResult = await executePlan(client, config, db, plan.plan_id);
    expect(execResult.status).toBe("denied");

    // Target booking start rolled back to original
    expect(bookingsStore[0].start).toBe(conflictStart);
  });
});
