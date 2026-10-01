/**
 * caldiy/client.ts — Typed HTTP wrapper for Cal.diy API v2
 *
 * IMPORTANT: Before implementing each method, read the actual endpoint shapes
 * from {CAL_API_URL}/docs and document findings in docs/caldiy-api-notes.md.
 * Never guess endpoint shapes (spec §0 rule 2).
 *
 * Error taxonomy (spec §11):
 *   slot_unavailable | not_found | auth_failed | rate_limited | upstream_error
 *
 * Behaviour:
 *   - 10s timeout on every request
 *   - Retry with exponential backoff on 429/5xx for READS only
 *   - Writes: no blind retry; use idempotency key + re-read to confirm
 *   - cal-api-version header pinned per endpoint group
 */

import type { Config } from "../config.js";

export class CalDiyError extends Error {
  constructor(
    public readonly code:
      | "slot_unavailable"
      | "not_found"
      | "auth_failed"
      | "rate_limited"
      | "upstream_error",
    message: string,
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = "CalDiyError";
  }
}

export class CalDiyClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(config: Pick<Config, "CAL_API_URL" | "CAL_API_KEY">) {
    this.baseUrl = config.CAL_API_URL;
    this.apiKey = config.CAL_API_KEY;
  }

  // TODO: implement after reading /docs
  // async getEventTypes(): Promise<EventType[]>
  // async getSlots(params: GetSlotsParams): Promise<Slot[]>
  // async createBooking(params: CreateBookingParams, idempotencyKey?: string): Promise<Booking>
  // async getBookings(params: GetBookingsParams): Promise<Booking[]>
  // async getBooking(bookingUid: string): Promise<Booking>
  // async rescheduleBooking(bookingUid: string, params: RescheduleParams, idempotencyKey?: string): Promise<Booking>
  // async cancelBooking(bookingUid: string, idempotencyKey?: string): Promise<void>
  // async getSchedule(): Promise<Schedule>
  // async getUserInfo(): Promise<UserInfo>
}
