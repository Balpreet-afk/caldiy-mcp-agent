/**
 * notify/index.ts — Fire-and-forget webhook outbox (spec §12)
 *
 * If NOTIFY_WEBHOOK_URL is set, POSTs a JSON event after:
 *   - executed plans, displacements, notable denials, approval requests
 *
 * Events: { type, ts, summary, plan_id, booking_uids }
 * Uses SQLite notify_outbox for retry queue.
 * Never sends email. No templates.
 */
import type Database from "better-sqlite3";
export interface WebhookEvent {
    type: "plan_executed" | "displacement" | "approval_requested" | "denial";
    ts: string;
    summary: string;
    plan_id?: string;
    booking_uids: string[];
}
export declare class NotifyOutbox {
    private readonly db;
    private readonly webhookUrl;
    constructor(db: Database.Database, webhookUrl: string | undefined);
    /** Enqueue an event for fire-and-forget delivery */
    enqueue(event: WebhookEvent): void;
    /** Process pending outbox entries (call periodically or after enqueue) */
    flush(): Promise<void>;
}
//# sourceMappingURL=index.d.ts.map