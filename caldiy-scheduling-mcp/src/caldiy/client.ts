/**
 * caldiy/client.ts — Typed HTTP wrapper for Cal.diy API v2
 */

import type { Config } from "../config.js";
import type {
  EventType,
  Slot,
  Booking,
  Schedule,
  UserInfo,
  Attendee,
} from "./types.js";

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

export interface GetSlotsParams {
  eventTypeId?: number;
  eventTypeSlug?: string;
  startTime: string; // ISO
  endTime: string;   // ISO
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

export class CalDiyClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly defaultApiVersion = "2024-08-13";
  private readonly timeoutMs = 10_000;

  constructor(config: Pick<Config, "CAL_API_URL" | "CAL_API_KEY">) {
    this.baseUrl = config.CAL_API_URL.replace(/\/+$/, "");
    this.apiKey = config.CAL_API_KEY;
  }

  private mapHttpStatusToErrorCode(
    status: number
  ): "slot_unavailable" | "not_found" | "auth_failed" | "rate_limited" | "upstream_error" {
    if (status === 409) return "slot_unavailable";
    if (status === 404) return "not_found";
    if (status === 401 || status === 403) return "auth_failed";
    if (status === 429) return "rate_limited";
    return "upstream_error";
  }

  private async request<T>(
    endpoint: string,
    options: {
      method?: "GET" | "POST" | "PATCH" | "DELETE";
      body?: unknown;
      params?: Record<string, string | number | undefined>;
      headers?: Record<string, string>;
      isRead?: boolean;
    } = {}
  ): Promise<T> {
    const { method = "GET", body, params, headers = {}, isRead = true } = options;

    const url = new URL(
      endpoint.startsWith("http") ? endpoint : `${this.baseUrl}${endpoint.startsWith("/") ? "" : "/"}${endpoint}`
    );

    if (params) {
      for (const [key, val] of Object.entries(params)) {
        if (val !== undefined && val !== null) {
          url.searchParams.set(key, String(val));
        }
      }
    }

    const requestHeaders: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      "Content-Type": "application/json",
      "cal-api-version": this.defaultApiVersion,
      ...headers,
    };

    const maxRetries = isRead ? 3 : 1;
    let attempt = 0;
    let lastError: unknown;

    while (attempt < maxRetries) {
      attempt++;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);

      try {
        const res = await fetch(url.toString(), {
          method,
          headers: requestHeaders,
          body: body ? JSON.stringify(body) : undefined,
          signal: controller.signal,
        });
        clearTimeout(timer);

        if (!res.ok) {
          let errorMsg = `HTTP ${res.status} ${res.statusText}`;
          try {
            const errJson = await res.json() as { message?: string; error?: { message?: string } };
            if (errJson.error?.message) {
              errorMsg = errJson.error.message;
            } else if (errJson.message) {
              errorMsg = errJson.message;
            }
          } catch {
            // ignore non-json error body
          }

          const errorCode = this.mapHttpStatusToErrorCode(res.status);

          // Retry on 429 or 5xx for reads
          if (isRead && (res.status === 429 || res.status >= 500) && attempt < maxRetries) {
            const backoffMs = Math.pow(2, attempt - 1) * 50;
            await new Promise((r) => setTimeout(r, backoffMs));
            continue;
          }

          throw new CalDiyError(errorCode, errorMsg);
        }

        const json = (await res.json()) as { status?: string; data?: T } | T;
        if (json && typeof json === "object" && "data" in json) {
          return (json as { data: T }).data;
        }
        return json as T;
      } catch (err: unknown) {
        clearTimeout(timer);
        if (err instanceof CalDiyError) {
          throw err;
        }

        const isAbort = (err as { name?: string }).name === "AbortError";
        const message = isAbort
          ? `Request timed out after ${this.timeoutMs}ms`
          : (err as Error).message || "Network error";

        lastError = new CalDiyError("upstream_error", message, err);

        if (isRead && attempt < maxRetries) {
          const backoffMs = Math.pow(2, attempt - 1) * 50;
          await new Promise((r) => setTimeout(r, backoffMs));
          continue;
        }

        throw lastError;
      }
    }

    throw lastError;
  }

  async getUserInfo(): Promise<UserInfo> {
    return this.request<UserInfo>("/v2/me", { method: "GET", isRead: true });
  }

  async getSchedule(): Promise<Schedule> {
    try {
      return await this.request<Schedule>("/v2/schedules/default", { method: "GET", isRead: true });
    } catch {
      return await this.request<Schedule>("/v2/schedules", { method: "GET", isRead: true });
    }
  }

  async getEventTypes(params?: { take?: number; skip?: number }): Promise<EventType[]> {
    interface RawEventType {
      id: number;
      title: string;
      slug: string;
      length?: number;
      lengthInMinutes?: number;
      description?: string;
    }

    const raw = await this.request<RawEventType[]>("/v2/event-types", {
      method: "GET",
      params: {
        take: params?.take,
        skip: params?.skip,
      },
      isRead: true,
    });

    return (Array.isArray(raw) ? raw : []).map((e) => ({
      id: e.id,
      title: e.title,
      slug: e.slug,
      length: e.length ?? e.lengthInMinutes ?? 30,
      description: e.description,
    }));
  }

  async getSlots(params: GetSlotsParams): Promise<Slot[]> {
    interface RawSlotResponse {
      slots: Record<string, Array<{ time: string }>>;
    }

    const raw = await this.request<RawSlotResponse>("/v2/slots", {
      method: "GET",
      params: {
        startTime: params.startTime,
        endTime: params.endTime,
        eventTypeId: params.eventTypeId,
        eventTypeSlug: params.eventTypeSlug,
        timeZone: params.timeZone,
        duration: params.duration,
        rescheduleUid: params.rescheduleUid,
      },
      isRead: true,
    });

    const duration = params.duration || 30;
    const durationMs = duration * 60 * 1000;
    const result: Slot[] = [];

    if (raw && raw.slots && typeof raw.slots === "object") {
      for (const slotList of Object.values(raw.slots)) {
        if (Array.isArray(slotList)) {
          for (const s of slotList) {
            if (s && s.time) {
              const startIso = new Date(s.time).toISOString();
              const endIso = new Date(new Date(s.time).getTime() + durationMs).toISOString();
              result.push({ start: startIso, end: endIso });
            }
          }
        }
      }
    }

    result.sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
    return result;
  }

  async getBookings(params?: GetBookingsParams): Promise<Booking[]> {
    return this.request<Booking[]>("/v2/bookings", {
      method: "GET",
      params: {
        status: params?.status,
        afterStart: params?.afterStart,
        beforeEnd: params?.beforeEnd,
        attendeeEmail: params?.attendeeEmail,
        eventTypeId: params?.eventTypeId,
        take: params?.take,
        skip: params?.skip,
      },
      isRead: true,
    });
  }

  async getBooking(bookingUid: string): Promise<Booking> {
    return this.request<Booking>(`/v2/bookings/${encodeURIComponent(bookingUid)}`, {
      method: "GET",
      isRead: true,
    });
  }

  async createBooking(
    params: CreateBookingParams,
    idempotencyKey?: string
  ): Promise<Booking> {
    const headers: Record<string, string> = {};
    if (idempotencyKey) {
      headers["Idempotency-Key"] = idempotencyKey;
    }

    return this.request<Booking>("/v2/bookings", {
      method: "POST",
      body: params,
      headers,
      isRead: false,
    });
  }

  async rescheduleBooking(
    bookingUid: string,
    params: RescheduleBookingParams,
    idempotencyKey?: string
  ): Promise<Booking> {
    const headers: Record<string, string> = {};
    if (idempotencyKey) {
      headers["Idempotency-Key"] = idempotencyKey;
    }

    return this.request<Booking>(`/v2/bookings/${encodeURIComponent(bookingUid)}/reschedule`, {
      method: "POST",
      body: params,
      headers,
      isRead: false,
    });
  }

  async cancelBooking(
    bookingUid: string,
    params?: CancelBookingParams,
    idempotencyKey?: string
  ): Promise<Booking> {
    const headers: Record<string, string> = {};
    if (idempotencyKey) {
      headers["Idempotency-Key"] = idempotencyKey;
    }

    return this.request<Booking>(`/v2/bookings/${encodeURIComponent(bookingUid)}/cancel`, {
      method: "POST",
      body: params || {},
      headers,
      isRead: false,
    });
  }
}
