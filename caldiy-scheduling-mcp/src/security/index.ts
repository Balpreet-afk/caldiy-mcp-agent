/**
 * security/index.ts — Input sanitization, rate limiting, auth helpers
 *
 * Spec §10 requirements:
 *  - sanitizeUntrusted(): strip control chars, cap length, return in `untrusted` field
 *  - RateLimiter: per-process token bucket per tool + per attendee email
 *  - verifyBearer(): constant-time compare for HTTP transport
 *  - Never concatenate untrusted strings into tool descriptions / status messages
 */

import { timingSafeEqual, createHash } from "node:crypto";

// ---------------------------------------------------------------------------
// Untrusted string sanitization
// ---------------------------------------------------------------------------

const MAX_UNTRUSTED_LENGTH = 500;

/** Strip control characters and cap length for any attendee-supplied string */
export function sanitizeUntrusted(raw: string): string {
  return raw
    .replace(/[\x00-\x1f\x7f]/g, "") // strip control chars
    .slice(0, MAX_UNTRUSTED_LENGTH);
}

// ---------------------------------------------------------------------------
// Bearer token verification (constant-time)
// ---------------------------------------------------------------------------

export function verifyBearer(provided: string, expected: string): boolean {
  if (provided.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
}

// ---------------------------------------------------------------------------
// Rate limiter — simple token bucket, per-process
// ---------------------------------------------------------------------------

interface Bucket {
  tokens: number;
  lastRefill: number;
}

export class RateLimiter {
  private readonly buckets = new Map<string, Bucket>();
  private readonly capacityPerMinute: number;

  constructor(capacityPerMinute: number) {
    this.capacityPerMinute = capacityPerMinute;
  }

  /** Returns true if the request is allowed, false if rate-limited */
  allow(key: string): boolean {
    const now = Date.now();
    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = { tokens: this.capacityPerMinute, lastRefill: now };
      this.buckets.set(key, bucket);
    }
    const elapsed = (now - bucket.lastRefill) / 60_000; // fraction of minute
    bucket.tokens = Math.min(
      this.capacityPerMinute,
      bucket.tokens + elapsed * this.capacityPerMinute
    );
    bucket.lastRefill = now;
    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      return true;
    }
    return false;
  }
}

// ---------------------------------------------------------------------------
// Config hash — used to detect policy changes between plan + execute
// ---------------------------------------------------------------------------

export function hashConfig(config: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(config))
    .digest("hex")
    .slice(0, 16);
}
