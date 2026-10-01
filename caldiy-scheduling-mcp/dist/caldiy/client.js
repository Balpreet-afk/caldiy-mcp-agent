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
    constructor(config) {
        this.baseUrl = config.CAL_API_URL;
        this.apiKey = config.CAL_API_KEY;
    }
}
//# sourceMappingURL=client.js.map