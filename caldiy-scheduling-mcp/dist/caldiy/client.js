/**
 * caldiy/client.ts — Typed HTTP wrapper for Cal.diy API v2
 */
export class CalDiyError extends Error {
    code;
    cause;
    constructor(code, message, cause) {
        super(message);
        this.code = code;
        this.cause = cause;
        this.name = "CalDiyError";
    }
}
export class CalDiyClient {
    baseUrl;
    apiKey;
    defaultApiVersion = "2024-08-13";
    timeoutMs = 10_000;
    constructor(config) {
        this.baseUrl = config.CAL_API_URL.replace(/\/+$/, "");
        this.apiKey = config.CAL_API_KEY;
    }
    mapHttpStatusToErrorCode(status) {
        if (status === 409)
            return "slot_unavailable";
        if (status === 404)
            return "not_found";
        if (status === 401 || status === 403)
            return "auth_failed";
        if (status === 429)
            return "rate_limited";
        return "upstream_error";
    }
    async request(endpoint, options = {}) {
        const { method = "GET", body, params, headers = {}, isRead = true } = options;
        const url = new URL(endpoint.startsWith("http") ? endpoint : `${this.baseUrl}${endpoint.startsWith("/") ? "" : "/"}${endpoint}`);
        if (params) {
            for (const [key, val] of Object.entries(params)) {
                if (val !== undefined && val !== null) {
                    url.searchParams.set(key, String(val));
                }
            }
        }
        const requestHeaders = {
            Authorization: `Bearer ${this.apiKey}`,
            "Content-Type": "application/json",
            "cal-api-version": this.defaultApiVersion,
            ...headers,
        };
        const maxRetries = isRead ? 3 : 1;
        let attempt = 0;
        let lastError;
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
                        const errJson = await res.json();
                        if (errJson.error?.message) {
                            errorMsg = errJson.error.message;
                        }
                        else if (errJson.message) {
                            errorMsg = errJson.message;
                        }
                    }
                    catch {
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
                const json = (await res.json());
                if (json && typeof json === "object" && "data" in json) {
                    return json.data;
                }
                return json;
            }
            catch (err) {
                clearTimeout(timer);
                if (err instanceof CalDiyError) {
                    throw err;
                }
                const isAbort = err.name === "AbortError";
                const message = isAbort
                    ? `Request timed out after ${this.timeoutMs}ms`
                    : err.message || "Network error";
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
    async getUserInfo() {
        return this.request("/v2/me", { method: "GET", isRead: true });
    }
    async getSchedule() {
        try {
            return await this.request("/v2/schedules/default", { method: "GET", isRead: true });
        }
        catch {
            return await this.request("/v2/schedules", { method: "GET", isRead: true });
        }
    }
    async getEventTypes(params) {
        const raw = await this.request("/v2/event-types", {
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
    async getSlots(params) {
        const raw = await this.request("/v2/slots", {
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
        const result = [];
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
    async getBookings(params) {
        return this.request("/v2/bookings", {
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
    async getBooking(bookingUid) {
        return this.request(`/v2/bookings/${encodeURIComponent(bookingUid)}`, {
            method: "GET",
            isRead: true,
        });
    }
    async createBooking(params, idempotencyKey) {
        const headers = {};
        if (idempotencyKey) {
            headers["Idempotency-Key"] = idempotencyKey;
        }
        return this.request("/v2/bookings", {
            method: "POST",
            body: params,
            headers,
            isRead: false,
        });
    }
    async rescheduleBooking(bookingUid, params, idempotencyKey) {
        const headers = {};
        if (idempotencyKey) {
            headers["Idempotency-Key"] = idempotencyKey;
        }
        return this.request(`/v2/bookings/${encodeURIComponent(bookingUid)}/reschedule`, {
            method: "POST",
            body: params,
            headers,
            isRead: false,
        });
    }
    async cancelBooking(bookingUid, params, idempotencyKey) {
        const headers = {};
        if (idempotencyKey) {
            headers["Idempotency-Key"] = idempotencyKey;
        }
        return this.request(`/v2/bookings/${encodeURIComponent(bookingUid)}/cancel`, {
            method: "POST",
            body: params || {},
            headers,
            isRead: false,
        });
    }
}
//# sourceMappingURL=client.js.map