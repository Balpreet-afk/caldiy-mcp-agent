import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http from "node:http";
import Database from "better-sqlite3";
import { createHttpServer } from "../src/http.js";
import type { Config } from "../src/config.js";

describe("HTTP Transport & Bearer Token Authentication", () => {
  let server: http.Server;
  let port: number;
  let db: Database.Database;

  const mockConfig: Config = {
    CAL_API_URL: "http://localhost:5555",
    CAL_API_KEY: "cal_test_key",
    MCP_PROFILE: "public",
    MCP_TRANSPORT: "http",
    MCP_HTTP_PORT: 0,
    MCP_HTTP_BEARER_TOKEN: "secret-bearer-token-123",
    POLICY_FILE: "./policy.yaml",
    DATA_DIR: ":memory:",
    DRY_RUN: false,
    policy: {
      autonomy_level: 3,
      timezone: "UTC",
      working_hours: { "mon-fri": ["09:00-17:00"] },
      default_priority: "NORMAL",
      priority_rules: [],
      displacement: {
        matrix: {},
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
    },
  };

  beforeAll(async () => {
    db = new Database(":memory:");
    db.exec(`
      CREATE TABLE IF NOT EXISTS audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts TEXT NOT NULL DEFAULT (datetime('now')),
        profile TEXT NOT NULL,
        client_name TEXT, client_version TEXT, conversation_id TEXT,
        tool TEXT NOT NULL, action_type TEXT, booking_uid TEXT, plan_id TEXT,
        input_hash TEXT, old_value TEXT, new_value TEXT, policy_decision TEXT,
        policy_rule TEXT, status TEXT NOT NULL, error TEXT, dry_run INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS plans (
        plan_id TEXT PRIMARY KEY, created_at TEXT NOT NULL DEFAULT (datetime('now')),
        expires_at TEXT NOT NULL, steps_json TEXT NOT NULL, policy_json TEXT NOT NULL,
        config_hash TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', idempotency_key TEXT UNIQUE
      );
      CREATE TABLE IF NOT EXISTS approvals (
        approval_id TEXT PRIMARY KEY, plan_id TEXT NOT NULL, plan_hash TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')), expires_at TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending'
      );
      CREATE TABLE IF NOT EXISTS meeting_priority (
        booking_uid TEXT PRIMARY KEY, priority TEXT NOT NULL,
        source TEXT NOT NULL CHECK (source IN ('rule','owner')), reason TEXT, updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS notify_outbox (
        id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT NOT NULL DEFAULT (datetime('now')),
        next_retry TEXT NOT NULL DEFAULT (datetime('now')), attempts INTEGER NOT NULL DEFAULT 0,
        payload TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending'
      );
    `);
    server = createHttpServer(mockConfig, db);
    await new Promise<void>((resolve) => {
      server.listen(0, () => {
        const addr = server.address();
        if (addr && typeof addr === "object") {
          port = addr.port;
        }
        resolve();
      });
    });
  });

  afterAll(async () => {
    db.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("serves health check without auth", async () => {
    const res = await fetch(`http://localhost:${port}/health`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
  });

  it("rejects /mcp request without bearer token (401)", async () => {
    const res = await fetch(`http://localhost:${port}/mcp`, { method: "POST", body: "{}" });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toContain("Unauthorized");
  });

  it("rejects /mcp request with invalid bearer token (401)", async () => {
    const res = await fetch(`http://localhost:${port}/mcp`, {
      method: "POST",
      headers: { Authorization: "Bearer wrong-token" },
      body: "{}",
    });
    expect(res.status).toBe(401);
  });

  it("accepts /mcp POST with valid Authorization header", async () => {
    const res = await fetch(`http://localhost:${port}/mcp`, {
      method: "POST",
      headers: {
        Authorization: "Bearer secret-bearer-token-123",
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "test", version: "0.0.1" },
        },
      }),
    });
    expect([200, 202]).toContain(res.status);
  });

  it("accepts /mcp POST with token query parameter", async () => {
    const res = await fetch(`http://localhost:${port}/mcp?token=secret-bearer-token-123`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "test", version: "0.0.1" },
        },
      }),
    });
    expect([200, 202]).toContain(res.status);
  });

  it("returns 404 for unknown paths", async () => {
    const res = await fetch(`http://localhost:${port}/sse`);
    expect(res.status).toBe(404);
  });
});
