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
export declare function openStore(dataDir: string): Database.Database;
//# sourceMappingURL=index.d.ts.map