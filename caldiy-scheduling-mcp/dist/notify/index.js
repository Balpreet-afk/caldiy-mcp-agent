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
export class NotifyOutbox {
    db;
    webhookUrl;
    constructor(db, webhookUrl) {
        this.db = db;
        this.webhookUrl = webhookUrl;
    }
    /** Enqueue an event for fire-and-forget delivery */
    enqueue(event) {
        if (!this.webhookUrl)
            return;
        this.db
            .prepare(`INSERT INTO notify_outbox (payload) VALUES (?)`)
            .run(JSON.stringify(event));
        // TODO: trigger flush (async, non-blocking, with retry)
    }
    /** Process pending outbox entries (call periodically or after enqueue) */
    async flush() {
        // TODO: SELECT pending rows, POST to webhookUrl, update status / next_retry
        throw new Error("Not implemented");
    }
}
//# sourceMappingURL=index.js.map