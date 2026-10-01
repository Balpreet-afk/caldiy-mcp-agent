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
export declare class CalDiyError extends Error {
    readonly code: "slot_unavailable" | "not_found" | "auth_failed" | "rate_limited" | "upstream_error";
    readonly cause?: unknown | undefined;
    constructor(code: "slot_unavailable" | "not_found" | "auth_failed" | "rate_limited" | "upstream_error", message: string, cause?: unknown | undefined);
}
export declare class CalDiyClient {
    private readonly baseUrl;
    private readonly apiKey;
    constructor(config: Pick<Config, "CAL_API_URL" | "CAL_API_KEY">);
}
//# sourceMappingURL=client.d.ts.map