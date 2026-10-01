/**
 * store/index.ts — SQLite store: audit log, plans, approvals, priorities
 */

import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { Priority } from "../config.js";

export interface AuditRow {
  id?: number;
  ts?: string;
  profile: "public" | "owner";
  client_name?: string;
  client_version?: string;
  conversation_id?: string;
  tool: string;
  action_type?: string;
  booking_uid?: string;
  plan_id?: string;
  input_hash?: string;
  old_value?: string;
  new_value?: string;
  policy_decision?: string;
  policy_rule?: string;
  status: "success" | "denied" | "error" | "pending";
  error?: string;
  dry_run?: boolean | number;
}

export interface PlanRow {
  plan_id: string;
  created_at: string;
  expires_at: string;
  steps_json: string;
  policy_json: string;
  config_hash: string;
  status: "pending" | "executed" | "cancelled" | "expired";
  idempotency_key?: string;
}

export interface ApprovalRow {
  approval_id: string;
  plan_id: string;
  plan_hash: string;
  created_at: string;
  expires_at: string;
  status: "pending" | "approved" | "rejected";
}

export interface MeetingPriorityRow {
  booking_uid: string;
  priority: Priority;
  source: "rule" | "owner";
  reason?: string;
  updated_at: string;
}

export function openStore(dataDir: string): Database.Database {
  mkdirSync(dataDir, { recursive: true });
  const db = new Database(join(dataDir, "store.db"));
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  runMigrations(db);
  return db;
}

function runMigrations(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS audit_log (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      ts              TEXT NOT NULL DEFAULT (datetime('now')),
      profile         TEXT NOT NULL,
      client_name     TEXT,
      client_version  TEXT,
      conversation_id TEXT,
      tool            TEXT NOT NULL,
      action_type     TEXT,
      booking_uid     TEXT,
      plan_id         TEXT,
      input_hash      TEXT,
      old_value       TEXT,
      new_value       TEXT,
      policy_decision TEXT,
      policy_rule     TEXT,
      status          TEXT NOT NULL,
      error           TEXT,
      dry_run         INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS plans (
      plan_id         TEXT PRIMARY KEY,
      created_at      TEXT NOT NULL DEFAULT (datetime('now')),
      expires_at      TEXT NOT NULL,
      steps_json      TEXT NOT NULL,
      policy_json     TEXT NOT NULL,
      config_hash     TEXT NOT NULL,
      status          TEXT NOT NULL DEFAULT 'pending',
      idempotency_key TEXT UNIQUE
    );

    CREATE TABLE IF NOT EXISTS approvals (
      approval_id     TEXT PRIMARY KEY,
      plan_id         TEXT NOT NULL REFERENCES plans(plan_id),
      plan_hash       TEXT NOT NULL,
      created_at      TEXT NOT NULL DEFAULT (datetime('now')),
      expires_at      TEXT NOT NULL,
      status          TEXT NOT NULL DEFAULT 'pending'
    );

    CREATE TABLE IF NOT EXISTS meeting_priority (
      booking_uid     TEXT PRIMARY KEY,
      priority        TEXT NOT NULL,
      source          TEXT NOT NULL CHECK (source IN ('rule','owner')),
      reason          TEXT,
      updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS notify_outbox (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at      TEXT NOT NULL DEFAULT (datetime('now')),
      next_retry      TEXT NOT NULL DEFAULT (datetime('now')),
      attempts        INTEGER NOT NULL DEFAULT 0,
      payload         TEXT NOT NULL,
      status          TEXT NOT NULL DEFAULT 'pending'
    );
  `);
}

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

export function logAudit(db: Database.Database, row: Partial<AuditRow>): void {
  try {
    const stmt = db.prepare(`
      INSERT INTO audit_log (
        profile, client_name, client_version, conversation_id,
        tool, action_type, booking_uid, plan_id, input_hash,
        old_value, new_value, policy_decision, policy_rule,
        status, error, dry_run
      ) VALUES (
        @profile, @client_name, @client_version, @conversation_id,
        @tool, @action_type, @booking_uid, @plan_id, @input_hash,
        @old_value, @new_value, @policy_decision, @policy_rule,
        @status, @error, @dry_run
      )
    `);

    stmt.run({
      profile: row.profile || "public",
      client_name: row.client_name || null,
      client_version: row.client_version || null,
      conversation_id: row.conversation_id || null,
      tool: row.tool || "unknown",
      action_type: row.action_type || null,
      booking_uid: row.booking_uid || null,
      plan_id: row.plan_id || null,
      input_hash: row.input_hash || null,
      old_value: row.old_value || null,
      new_value: row.new_value || null,
      policy_decision: row.policy_decision || null,
      policy_rule: row.policy_rule || null,
      status: row.status || "success",
      error: row.error || null,
      dry_run: row.dry_run ? 1 : 0,
    });
  } catch (err) {
    console.error("Failed to log audit:", err);
  }
}

export function queryAudit(
  db: Database.Database,
  filters: { booking_uid?: string; plan_id?: string; tool?: string; limit?: number } = {}
): AuditRow[] {
  let sql = "SELECT * FROM audit_log WHERE 1=1";
  const params: unknown[] = [];

  if (filters.booking_uid) {
    sql += " AND booking_uid = ?";
    params.push(filters.booking_uid);
  }
  if (filters.plan_id) {
    sql += " AND plan_id = ?";
    params.push(filters.plan_id);
  }
  if (filters.tool) {
    sql += " AND tool = ?";
    params.push(filters.tool);
  }

  sql += " ORDER BY id DESC LIMIT ?";
  params.push(filters.limit || 100);

  return db.prepare(sql).all(...params) as AuditRow[];
}

// ---------------------------------------------------------------------------
// Plans
// ---------------------------------------------------------------------------

export function savePlan(
  db: Database.Database,
  plan: {
    plan_id: string;
    expires_at: string;
    steps_json: string;
    policy_json: string;
    config_hash: string;
    idempotency_key?: string;
  }
): void {
  const stmt = db.prepare(`
    INSERT INTO plans (plan_id, expires_at, steps_json, policy_json, config_hash, status, idempotency_key)
    VALUES (?, ?, ?, ?, ?, 'pending', ?)
  `);
  stmt.run(
    plan.plan_id,
    plan.expires_at,
    plan.steps_json,
    plan.policy_json,
    plan.config_hash,
    plan.idempotency_key || null
  );
}

export function getPlan(db: Database.Database, planId: string): PlanRow | undefined {
  return db.prepare("SELECT * FROM plans WHERE plan_id = ?").get(planId) as PlanRow | undefined;
}

export function getPlanByIdempotencyKey(
  db: Database.Database,
  key: string
): PlanRow | undefined {
  return db.prepare("SELECT * FROM plans WHERE idempotency_key = ?").get(key) as PlanRow | undefined;
}

export function updatePlanStatus(
  db: Database.Database,
  planId: string,
  status: "pending" | "executed" | "cancelled" | "expired"
): void {
  db.prepare("UPDATE plans SET status = ? WHERE plan_id = ?").run(status, planId);
}

// ---------------------------------------------------------------------------
// Approvals
// ---------------------------------------------------------------------------

export function createApproval(
  db: Database.Database,
  planId: string,
  planHash: string,
  ttlMinutes = 60
): ApprovalRow {
  const approvalId = `appr_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  const expiresAt = new Date(Date.now() + ttlMinutes * 60_000).toISOString();

  db.prepare(`
    INSERT INTO approvals (approval_id, plan_id, plan_hash, expires_at, status)
    VALUES (?, ?, ?, ?, 'pending')
  `).run(approvalId, planId, planHash, expiresAt);

  return {
    approval_id: approvalId,
    plan_id: planId,
    plan_hash: planHash,
    created_at: new Date().toISOString(),
    expires_at: expiresAt,
    status: "pending",
  };
}

export function getApproval(
  db: Database.Database,
  approvalId: string
): ApprovalRow | undefined {
  return db.prepare("SELECT * FROM approvals WHERE approval_id = ?").get(approvalId) as
    | ApprovalRow
    | undefined;
}

export function getApprovalByPlanId(
  db: Database.Database,
  planId: string
): ApprovalRow | undefined {
  return db.prepare("SELECT * FROM approvals WHERE plan_id = ? ORDER BY created_at DESC LIMIT 1").get(
    planId
  ) as ApprovalRow | undefined;
}

export function listPendingApprovals(db: Database.Database): ApprovalRow[] {
  return db
    .prepare("SELECT * FROM approvals WHERE status = 'pending' AND expires_at > datetime('now')")
    .all() as ApprovalRow[];
}

export function updateApprovalStatus(
  db: Database.Database,
  approvalId: string,
  status: "pending" | "approved" | "rejected"
): void {
  db.prepare("UPDATE approvals SET status = ? WHERE approval_id = ?").run(status, approvalId);
}

// ---------------------------------------------------------------------------
// Meeting Priorities
// ---------------------------------------------------------------------------

export function getStoredPriority(
  db: Database.Database,
  bookingUid: string
): MeetingPriorityRow | undefined {
  return db
    .prepare("SELECT * FROM meeting_priority WHERE booking_uid = ?")
    .get(bookingUid) as MeetingPriorityRow | undefined;
}

export function setStoredPriority(
  db: Database.Database,
  bookingUid: string,
  priority: Priority,
  source: "rule" | "owner",
  reason?: string
): void {
  db.prepare(`
    INSERT INTO meeting_priority (booking_uid, priority, source, reason, updated_at)
    VALUES (?, ?, ?, ?, datetime('now'))
    ON CONFLICT(booking_uid) DO UPDATE SET
      priority = excluded.priority,
      source = excluded.source,
      reason = excluded.reason,
      updated_at = datetime('now')
  `).run(bookingUid, priority, source, reason || null);
}

export function countDisplacementsToday(db: Database.Database): number {
  const row = db
    .prepare(`
      SELECT COUNT(*) as count FROM audit_log
      WHERE action_type = 'displacement'
        AND status = 'success'
        AND ts >= datetime('now', 'start of day')
    `)
    .get() as { count: number };
  return row ? row.count : 0;
}
