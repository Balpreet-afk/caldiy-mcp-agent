/**
 * store/index.ts — SQLite store: audit log, plans, approvals, priorities
 */
import Database from "better-sqlite3";
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
export declare function openStore(dataDir: string): Database.Database;
export declare function logAudit(db: Database.Database, row: Partial<AuditRow>): void;
export declare function queryAudit(db: Database.Database, filters?: {
    booking_uid?: string;
    plan_id?: string;
    tool?: string;
    limit?: number;
}): AuditRow[];
export declare function savePlan(db: Database.Database, plan: {
    plan_id: string;
    expires_at: string;
    steps_json: string;
    policy_json: string;
    config_hash: string;
    idempotency_key?: string;
}): void;
export declare function getPlan(db: Database.Database, planId: string): PlanRow | undefined;
export declare function getPlanByIdempotencyKey(db: Database.Database, key: string): PlanRow | undefined;
export declare function updatePlanStatus(db: Database.Database, planId: string, status: "pending" | "executed" | "cancelled" | "expired"): void;
export declare function createApproval(db: Database.Database, planId: string, planHash: string, ttlMinutes?: number): ApprovalRow;
export declare function getApproval(db: Database.Database, approvalId: string): ApprovalRow | undefined;
export declare function getApprovalByPlanId(db: Database.Database, planId: string): ApprovalRow | undefined;
export declare function listPendingApprovals(db: Database.Database): ApprovalRow[];
export declare function updateApprovalStatus(db: Database.Database, approvalId: string, status: "pending" | "approved" | "rejected"): void;
export declare function getStoredPriority(db: Database.Database, bookingUid: string): MeetingPriorityRow | undefined;
export declare function setStoredPriority(db: Database.Database, bookingUid: string, priority: Priority, source: "rule" | "owner", reason?: string): void;
export declare function countDisplacementsToday(db: Database.Database): number;
//# sourceMappingURL=index.d.ts.map