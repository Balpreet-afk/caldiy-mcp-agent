import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../src/server.js";
import { openStore } from "../src/store/index.js";
import { CalDiyClient } from "../src/caldiy/client.js";
import type { Config } from "../src/config.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CAL_API_URL = "http://localhost:5555";
const CAL_API_KEY = "cal_test_12345";

let tempDir: string;
let bookingsStore: any[] = [];

const mswServer = setupServer(
  http.get(`${CAL_API_URL}/v2/me`, () => {
    return HttpResponse.json({
      status: "success",
      data: {
        id: 1,
        email: "balpreet@example.com",
        username: "balpreet",
        name: "Balpreet",
        timeZone: "Asia/Kolkata",
      },
    });
  }),

  http.get(`${CAL_API_URL}/v2/event-types`, () => {
    return HttpResponse.json({
      status: "success",
      data: [
        { id: 1, title: "30 Min Chat", slug: "30min", length: 30, description: "Quick chat" },
        { id: 2, title: "Client Call", slug: "client-call", length: 45, description: "Client call" },
      ],
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
    const body = (await request.json()) as any;
    const newB = {
      id: Math.floor(Math.random() * 1000) + 100,
      uid: `bkg_${Math.random().toString(36).slice(2, 8)}`,
      title: "Booked Meeting",
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
  }),

  http.post(`${CAL_API_URL}/v2/bookings/:uid/cancel`, ({ params }) => {
    const b = bookingsStore.find((item) => item.uid === params.uid);
    if (!b) return HttpResponse.json({ error: { message: "Not found" } }, { status: 404 });
    b.status = "cancelled";
    return HttpResponse.json({ status: "success", data: b });
  })
);

beforeAll(() => mswServer.listen());
afterAll(() => mswServer.close());

afterEach(() => {
  mswServer.resetHandlers();
  try {
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  } catch {}
});

function getBaseConfig(profile: "public" | "owner"): { config: Config; db: any; client: CalDiyClient } {
  tempDir = mkdtempSync(join(tmpdir(), `mcp-${profile}-test-`));
  const db = openStore(tempDir);
  const client = new CalDiyClient({ CAL_API_URL, CAL_API_KEY });

  const config: Config = {
    CAL_API_URL,
    CAL_API_KEY,
    MCP_PROFILE: profile,
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
        tool_calls_per_minute: 100,
        bookings_per_day_per_attendee: 5,
      },
      approval_ttl_minutes: 60,
      plan_ttl_minutes: 5,
    },
  };

  return { config, db, client };
}

describe("MCP Server Contract Tests", () => {
  describe("Public Profile", () => {
    it("registers ONLY public tools and executes them", async () => {
      const { config, db, client: calClient } = getBaseConfig("public");
      const { server } = createServer(config, db, calClient);

      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      const mcpClient = new Client({ name: "test-client", version: "1.0.0" }, { capabilities: {} });

      await Promise.all([
        server.connect(serverTransport),
        mcpClient.connect(clientTransport),
      ]);

      const toolsList = await mcpClient.listTools();
      const toolNames = toolsList.tools.map((t) => t.name);

      // Verify public tools exist
      expect(toolNames).toContain("get_owner_info");
      expect(toolNames).toContain("find_slots");
      expect(toolNames).toContain("plan_booking");
      expect(toolNames).toContain("execute_plan");
      expect(toolNames).toContain("book_meeting");
      expect(toolNames).toContain("get_booking_status");
      expect(toolNames).toContain("reschedule_own_booking");
      expect(toolNames).toContain("cancel_own_booking");

      // Verify owner tools NEVER appear on public profile
      expect(toolNames).not.toContain("list_approvals");
      expect(toolNames).not.toContain("approve_action");
      expect(toolNames).not.toContain("reject_action");
      expect(toolNames).not.toContain("get_schedule");
      expect(toolNames).not.toContain("list_audit");
      expect(toolNames).not.toContain("set_meeting_priority");

      // Call get_owner_info
      const ownerInfo = await mcpClient.callTool({ name: "get_owner_info", arguments: {} });
      expect(ownerInfo.isError).toBeFalsy();
      const ownerData = JSON.parse((ownerInfo.content[0] as any).text);
      expect(ownerData.owner_name).toBe("Balpreet");
      expect(ownerData.event_types).toHaveLength(2);

      // Call find_slots
      const slotsRes = await mcpClient.callTool({
        name: "find_slots",
        arguments: {
          event_type_slug: "30min",
          date_from: "2026-10-02T00:00:00Z",
          date_to: "2026-10-05T00:00:00Z",
        },
      });
      expect(slotsRes.isError).toBeFalsy();

      // Call book_meeting
      const bookRes = await mcpClient.callTool({
        name: "book_meeting",
        arguments: {
          event_type_slug: "30min",
          start: "2026-10-02T10:00:00.000Z",
          attendee_email: "alice@example.com",
          attendee_name: "Alice Example",
          attendee_timezone: "Asia/Kolkata",
        },
      });
      expect(bookRes.isError).toBeFalsy();
      const bookedData = JSON.parse((bookRes.content[0] as any).text);
      expect(bookedData.status).toBe("executed");

      await mcpClient.close();
    });
  });

  describe("Owner Profile", () => {
    it("registers owner tools alongside public tools", async () => {
      const { config, db, client: calClient } = getBaseConfig("owner");
      const { server } = createServer(config, db, calClient);

      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      const mcpClient = new Client({ name: "owner-client", version: "1.0.0" }, { capabilities: {} });

      await Promise.all([
        server.connect(serverTransport),
        mcpClient.connect(clientTransport),
      ]);

      const toolsList = await mcpClient.listTools();
      const toolNames = toolsList.tools.map((t) => t.name);

      expect(toolNames).toContain("get_schedule");
      expect(toolNames).toContain("get_booking");
      expect(toolNames).toContain("get_meeting_priority");
      expect(toolNames).toContain("set_meeting_priority");
      expect(toolNames).toContain("get_policy");
      expect(toolNames).toContain("check_policy");
      expect(toolNames).toContain("list_approvals");
      expect(toolNames).toContain("approve_action");
      expect(toolNames).toContain("reject_action");
      expect(toolNames).toContain("list_audit");

      // Call get_policy
      const policyRes = await mcpClient.callTool({ name: "get_policy", arguments: {} });
      expect(policyRes.isError).toBeFalsy();

      // Call check_policy
      const checkRes = await mcpClient.callTool({
        name: "check_policy",
        arguments: {
          requested_priority: "HIGH",
          existing_priority: "LOW",
        },
      });
      const checkData = JSON.parse((checkRes.content[0] as any).text);
      expect(checkData.displacement_decision).toBe("auto");

      // Call list_audit
      const auditRes = await mcpClient.callTool({ name: "list_audit", arguments: {} });
      expect(auditRes.isError).toBeFalsy();

      await mcpClient.close();
    });
  });
});
