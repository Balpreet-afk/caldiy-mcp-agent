/**
 * caldiy/types.ts — Internal domain types
 */

export type Priority = "CRITICAL" | "HIGH" | "NORMAL" | "LOW";

export interface EventType {
  id: number;
  slug: string;
  title: string;
  length: number; // minutes
  description?: string;
}

export interface Slot {
  start: string; // ISO 8601
  end: string;   // ISO 8601
}

export interface Attendee {
  email: string;
  name: string;
  timeZone: string;
}

export interface BookingHost {
  id: number;
  name: string;
  email: string;
}

export interface Booking {
  id?: number;
  uid: string;
  title: string;
  start: string;
  end: string;
  status: "accepted" | "pending" | "cancelled" | "rejected" | string;
  eventTypeId: number;
  attendees: Attendee[];
  hosts?: BookingHost[];
  location?: string;
  meetingUrl?: string;
  metadata?: Record<string, unknown>;
  createdAt?: string;
}

export interface WorkingHour {
  days: number[]; // 0=Sun..6=Sat
  startTime: number; // minutes from midnight
  endTime: number;   // minutes from midnight
}

export interface Schedule {
  id: number;
  name: string;
  timeZone: string;
  isDefault?: boolean;
  workingHours?: WorkingHour[];
}

export interface UserInfo {
  id: number;
  email: string;
  username: string;
  name: string;
  timeZone: string;
}
