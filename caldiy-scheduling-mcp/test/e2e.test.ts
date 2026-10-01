import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../src/server.js";
import { openStore } from "../src/store/index.js";
import { CalDiyClient } from "../src/caldiy/client.js";
import type { Config } from "../src/config.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("End-to-End Workflow", () => {
  let tempDir: string;
  let publicClient: Client;
  let ownerClient: Client;

  beforeAll(async () => {
    tempDir = mkdtempSync(join(tmpdir(), "mcp-e2e-"));
    const db = openStore(tempDir);
    // Connect to live or container Cal.diy server at port 5555
    const calClient = new CalDiyClient({
      CAL_API_URL: process.env.CAL_API_URL || "http://localhost:5555",
      CAL_API_KEY: process.env.CAL_API_KEY || "cal_live_28a9b73491c107297eef840f34581290",
    });

    const publicConfig: Config = {
      CAL_API_URL: "http://localhost:5555",
      CAL_API_KEY: "cal_live_28a9b73491c107297eef840f34581290",
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
          tool_calls_per_minute: 100,
          bookings_per_day_per_attendee: 10,
        },
        approval_ttl_minutes: 60,
        plan_ttl_minutes: 5,
      },
    };

    const ownerConfig: Config = {
      ...publicConfig,
      MCP_PROFILE: "owner",
    };

    const publicServerObj = createServer(publicConfig, db, calClient);
    const ownerServerObj = createServer(ownerConfig, db, calClient);

    const [pubClientTransport, pubServerTransport] = InMemoryTransport.createLinkedPair();
    const [ownClientTransport, ownServerTransport] = InMemoryTransport.createLinkedPair();

    publicClient = new Client({ name: "e2e-public", version: "1.0.0" }, { capabilities: {} });
    ownerClient = new Client({ name: "e2e-owner", version: "1.0.0" }, { capabilities: {} });

    await Promise.all([
      publicServerObj.server.connect(pubServerTransport),
      publicClient.connect(pubClientTransport),
      ownerServerObj.server.connect(ownServerTransport),
      ownerClient.connect(ownClientTransport),
    ]);
  });

  afterAll(async () => {
    try {
      await publicClient.close();
      await ownerClient.close();
    } catch {}
    try {
      if (tempDir) rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  it("completes full scheduling flow end-to-end", async () => {
    // 1. get_owner_info
    const ownerInfo = await publicClient.callTool({ name: "get_owner_info", arguments: {} });
    expect(ownerInfo.isError).toBeFalsy();
    const info = JSON.parse((ownerInfo.content[0] as any).text);
    expect(info.owner_name).toBeDefined();

    // 2. find_slots
    const dateFrom = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
    const dateTo = new Date(Date.now() + 5 * 24 * 3600 * 1000).toISOString();

    const slotsRes = await publicClient.callTool({
      name: "find_slots",
      arguments: {
        event_type_slug: "30min",
        date_from: dateFrom,
        date_to: dateTo,
      },
    });
    expect(slotsRes.isError).toBeFalsy();
    const slotsData = JSON.parse((slotsRes.content[0] as any).text);
    expect(slotsData.free_slots).toBeDefined();

    const uniqueOffsetHours = 200 + Math.floor(Math.random() * 200);
    const targetSlot = new Date(Date.now() + uniqueOffsetHours * 3600 * 1000).toISOString();

    // 3. plan_booking for free slot
    const planRes = await publicClient.callTool({
      name: "plan_booking",
      arguments: {
        event_type_slug: "30min",
        start: targetSlot,
        attendee_email: "alice@kodev.studio", // Maps to LOW priority
        attendee_name: "E2E Tester",
        attendee_timezone: "Asia/Kolkata",
      },
    });
    expect(planRes.isError).toBeFalsy();
    const plan = JSON.parse((planRes.content[0] as any).text);
    expect(plan.plan_id).toBeDefined();
    expect(plan.policy.decision).toBe("auto");

    // 4. execute_plan
    const execRes = await publicClient.callTool({
      name: "execute_plan",
      arguments: { plan_id: plan.plan_id },
    });
    expect(execRes.isError).toBeFalsy();
    const execData = JSON.parse((execRes.content[0] as any).text);
    expect(execData.status).toBe("executed");

    // 5. plan displacement over existing booking (requesting client-call / HIGH over LOW)
    const dispPlanRes = await publicClient.callTool({
      name: "plan_booking",
      arguments: {
        event_type_slug: "client-call",
        start: targetSlot,
        attendee_email: "important-client@corporate.com",
        attendee_name: "Important Client",
        attendee_timezone: "Asia/Kolkata",
      },
    });
    const dispPlan = JSON.parse((dispPlanRes.content[0] as any).text);
    expect(dispPlan.plan_id).toBeDefined();

    // If approval required -> owner approves
    if (dispPlan.policy.decision === "approval_required" && dispPlan.approval_id) {
      const approveRes = await ownerClient.callTool({
        name: "approve_action",
        arguments: { approval_id: dispPlan.approval_id },
      });
      expect(approveRes.isError).toBeFalsy();
    }

    // Execute displacement plan
    const dispExecRes = await publicClient.callTool({
      name: "execute_plan",
      arguments: { plan_id: dispPlan.plan_id },
    });
    expect(dispExecRes.isError).toBeFalsy();

    // Check audit log on owner profile
    const auditRes = await ownerClient.callTool({
      name: "list_audit",
      arguments: { limit: 10 },
    });
    expect(auditRes.isError).toBeFalsy();
  });
});
