/**
 * caldiy/types.ts — Internal domain types
 * These will be refined once the actual Cal.diy API v2 shapes are confirmed.
 * See docs/caldiy-api-notes.md for verified endpoint contracts.
 */
export type Priority = "CRITICAL" | "HIGH" | "NORMAL" | "LOW";
export interface EventType {
    id: number;
    slug: string;
    title: string;
    length: number;
}
export interface Slot {
    start: string;
    end: string;
}
export interface Booking {
    uid: string;
    title: string;
    start: string;
    end: string;
    status: "ACCEPTED" | "PENDING" | "CANCELLED" | "REJECTED";
    eventTypeId: number;
    attendees: Attendee[];
    metadata?: Record<string, unknown>;
}
export interface Attendee {
    email: string;
    name: string;
    timeZone: string;
}
export interface Schedule {
    id: number;
    name: string;
    timeZone: string;
}
//# sourceMappingURL=types.d.ts.map