/**
 * Simple in-memory rate limiter for private single-user use.
 * Suitable for later replacement with Redis / edge limits.
 */

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterMs?: number;
}

interface Bucket {
  timestamps: number[];
}

const buckets = new Map<string, Bucket>();

export function checkRateLimit(options: {
  key: string;
  limit: number;
  windowMs: number;
  now?: number;
}): RateLimitResult {
  const now = options.now ?? Date.now();
  const bucket = buckets.get(options.key) ?? { timestamps: [] };
  bucket.timestamps = bucket.timestamps.filter(
    (t) => now - t < options.windowMs,
  );

  if (bucket.timestamps.length >= options.limit) {
    const oldest = bucket.timestamps[0] ?? now;
    buckets.set(options.key, bucket);
    return {
      allowed: false,
      remaining: 0,
      retryAfterMs: Math.max(0, options.windowMs - (now - oldest)),
    };
  }

  bucket.timestamps.push(now);
  buckets.set(options.key, bucket);
  return {
    allowed: true,
    remaining: Math.max(0, options.limit - bucket.timestamps.length),
  };
}

/** Test helper */
export function resetRateLimits(): void {
  buckets.clear();
}
