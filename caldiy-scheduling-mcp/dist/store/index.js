/**
 * store/index.ts — SQLite store: audit log, plans, approvals, priorities
 *
 * Uses better-sqlite3 (sync API). All tables are append-only or
 * soft-deleted. Migrations run at startup.
 *
 * Tables:
 *   audit_log       — every tool call logged, including denials (spec §9)
 *   plans           — plan_id, steps JSON, TTL, hash, status
 *   approvals       — approval_id, plan_id, plan_hash, status, ttl
 *   meeting_priority — booking_uid, priority, source, reason, updated_at
 *   notify_outbox   — fire-and-forget webhook retry queue (spec §12)
 */
import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
export function openStore(dataDir) {
    mkdirSync(dataDir, { recursive: true });
    const db = new Database(join(dataDir, "store.db"));
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    runMigrations(db);
    return db;
}
function runMigrations(db) {
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
      plan_id     TEXT PRIMARY KEY,
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      expires_at  TEXT NOT NULL,
      steps_json  TEXT NOT NULL,
      policy_json TEXT NOT NULL,
      config_hash TEXT NOT NULL,
      status      TEXT NOT NULL DEFAULT 'pending',
      idempotency_key TEXT UNIQUE
    );

    CREATE TABLE IF NOT EXISTS approvals (
      approval_id TEXT PRIMARY KEY,
      plan_id     TEXT NOT NULL REFERENCES plans(plan_id),
      plan_hash   TEXT NOT NULL,
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      expires_at  TEXT NOT NULL,
      status      TEXT NOT NULL DEFAULT 'pending'
    );

    CREATE TABLE IF NOT EXISTS meeting_priority (
      booking_uid TEXT PRIMARY KEY,
      priority    TEXT NOT NULL,
      source      TEXT NOT NULL CHECK (source IN ('rule','owner')),
      reason      TEXT,
      updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS notify_outbox (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      next_retry  TEXT NOT NULL DEFAULT (datetime('now')),
      attempts    INTEGER NOT NULL DEFAULT 0,
      payload     TEXT NOT NULL,
      status      TEXT NOT NULL DEFAULT 'pending'
    );
  `);
}
//# sourceMappingURL=index.js.map