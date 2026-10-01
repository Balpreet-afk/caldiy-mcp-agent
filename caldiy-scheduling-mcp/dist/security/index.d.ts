/**
 * security/index.ts — Input sanitization, rate limiting, auth helpers
 *
 * Spec §10 requirements:
 *  - sanitizeUntrusted(): strip control chars, cap length, return in `untrusted` field
 *  - RateLimiter: per-process token bucket per tool + per attendee email
 *  - verifyBearer(): constant-time compare for HTTP transport
 *  - Never concatenate untrusted strings into tool descriptions / status messages
 */
/** Strip control characters and cap length for any attendee-supplied string */
export declare function sanitizeUntrusted(raw: string): string;
export declare function verifyBearer(provided: string, expected: string): boolean;
export declare class RateLimiter {
    private readonly buckets;
    private readonly capacityPerMinute;
    constructor(capacityPerMinute: number);
    /** Returns true if the request is allowed, false if rate-limited */
    allow(key: string): boolean;
}
export declare function hashConfig(config: unknown): string;
//# sourceMappingURL=index.d.ts.map