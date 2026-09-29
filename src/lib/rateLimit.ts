// Best-effort sliding-window rate limiter for public endpoints (per server instance; on
// serverless each instance keeps its own window, so treat the numbers as "roughly").
const buckets = new Map<string, number[]>();

export function rateLimit(key: string, max: number, windowMs: number): { ok: boolean; remaining: number; retryAfterSec: number } {
  const now = Date.now();
  const hits = (buckets.get(key) ?? []).filter((t) => now - t < windowMs);
  if (hits.length >= max) {
    const retryAfterSec = Math.ceil((hits[0] + windowMs - now) / 1000);
    buckets.set(key, hits);
    return { ok: false, remaining: 0, retryAfterSec };
  }
  hits.push(now);
  buckets.set(key, hits);
  // Keep the map from growing without bound.
  if (buckets.size > 5000) for (const [k, v] of buckets) if (!v.some((t) => now - t < windowMs)) buckets.delete(k);
  return { ok: true, remaining: max - hits.length, retryAfterSec: 0 };
}

/** The caller's address behind Vercel's proxy. */
export function clientIp(headers: Headers): string {
  return (headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || headers.get("x-real-ip") || "unknown";
}
