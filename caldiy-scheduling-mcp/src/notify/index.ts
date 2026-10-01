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
  type:
    | "plan_executed"
    | "displacement"
    | "approval_requested"
    | "denial";
  ts: string;
  summary: string;
  plan_id?: string;
  booking_uids: string[];
}

export class NotifyOutbox {
  constructor(
    private readonly db: Database.Database,
    private readonly webhookUrl: string | undefined
  ) {}

  /** Enqueue an event for fire-and-forget delivery */
  enqueue(event: WebhookEvent): void {
    if (!this.webhookUrl) return;
    this.db
      .prepare(
        `INSERT INTO notify_outbox (payload) VALUES (?)`
      )
      .run(JSON.stringify(event));
    // TODO: trigger flush (async, non-blocking, with retry)
  }

  /** Process pending outbox entries (call periodically or after enqueue) */
  async flush(): Promise<void> {
    // TODO: SELECT pending rows, POST to webhookUrl, update status / next_retry
    throw new Error("Not implemented");
  }
}
