/**
 * caldiy/client.ts — Typed HTTP wrapper for Cal.diy API v2
 */
import type { Config } from "../config.js";
import type { EventType, Slot, Booking, Schedule, UserInfo, Attendee } from "./types.js";
export declare class CalDiyError extends Error {
    readonly code: "slot_unavailable" | "not_found" | "auth_failed" | "rate_limited" | "upstream_error";
    readonly cause?: unknown | undefined;
    constructor(code: "slot_unavailable" | "not_found" | "auth_failed" | "rate_limited" | "upstream_error", message: string, cause?: unknown | undefined);
}
export interface GetSlotsParams {
    eventTypeId?: number;
    eventTypeSlug?: string;
    startTime: string;
    endTime: string;
    timeZone?: string;
    duration?: number;
    rescheduleUid?: string;
}
export interface GetBookingsParams {
    status?: string;
    afterStart?: string;
    beforeEnd?: string;
    attendeeEmail?: string;
    eventTypeId?: number;
    take?: number;
    skip?: number;
}
export interface CreateBookingParams {
    start: string;
    eventTypeId: number;
    attendee: Attendee;
    metadata?: Record<string, unknown>;
}
export interface RescheduleBookingParams {
    start: string;
    reschedulingReason?: string;
}
export interface CancelBookingParams {
    cancellationReason?: string;
}
export declare class CalDiyClient {
    private readonly baseUrl;
    private readonly apiKey;
    private readonly defaultApiVersion;
    private readonly timeoutMs;
    constructor(config: Pick<Config, "CAL_API_URL" | "CAL_API_KEY">);
    private mapHttpStatusToErrorCode;
    private request;
    getUserInfo(): Promise<UserInfo>;
    getSchedule(): Promise<Schedule>;
    getEventTypes(params?: {
        take?: number;
        skip?: number;
    }): Promise<EventType[]>;
    getSlots(params: GetSlotsParams): Promise<Slot[]>;
    getBookings(params?: GetBookingsParams): Promise<Booking[]>;
    getBooking(bookingUid: string): Promise<Booking>;
    createBooking(params: CreateBookingParams, idempotencyKey?: string): Promise<Booking>;
    rescheduleBooking(bookingUid: string, params: RescheduleBookingParams, idempotencyKey?: string): Promise<Booking>;
    cancelBooking(bookingUid: string, params?: CancelBookingParams, idempotencyKey?: string): Promise<Booking>;
}
//# sourceMappingURL=client.d.ts.map