import { createHash } from "node:crypto";

// Rate limiting for the public endpoints (landing-page demos).
//   guardPublic()  — durable, shared across serverless instances: counts rows in
//                    public_demo_requests (service role). Falls back to the in-memory limiter
//                    below until the table exists (supabase-migration-public-demo-guard.sql).
//   rateLimit()    — best-effort sliding window per server instance.

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
  if (buckets.size > 5000) for (const [k, v] of buckets) if (!v.some((t) => now - t < windowMs)) buckets.delete(k);
  return { ok: true, remaining: max - hits.length, retryAfterSec: 0 };
}

/** The caller's address behind Vercel's proxy. */
export function clientIp(headers: Headers): string {
  return (headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || headers.get("x-real-ip") || "unknown";
}

const db = async () => (await import("./supabaseServer")).supabaseService;

/** IPs are stored hashed (salted with the platform secret), never raw. */
export function ipHash(ip: string): string {
  return createHash("sha256").update(`${process.env.INTEGRATIONS_ENCRYPTION_KEY ?? "voizo"}:${ip}`).digest("hex").slice(0, 32);
}

let tableMissing = false;
const missing = (e: unknown) => /does not exist|42P01|PGRST205|schema cache/i.test(String((e as { message?: string })?.message ?? e));

export interface GuardResult { ok: boolean; remaining: number; retryAfterSec: number; durable: boolean }

export async function guardPublic(kind: "call" | "match" | "summary", ip: string, max: number, windowMs: number, extra: { agentKey?: string } = {}): Promise<GuardResult> {
  if (tableMissing) return { ...rateLimit(`${kind}:${ip}`, max, windowMs), durable: false };
  try {
    const s = await db();
    const h = ipHash(ip);
    const since = new Date(Date.now() - windowMs).toISOString();
    const { count, error } = await s.from("public_demo_requests").select("id", { count: "exact", head: true }).eq("kind", kind).eq("ip_hash", h).gte("created_at", since);
    if (error) throw error;
    if ((count ?? 0) >= max) {
      const { data } = await s.from("public_demo_requests").select("created_at").eq("kind", kind).eq("ip_hash", h).gte("created_at", since).order("created_at", { ascending: true }).limit(1);
      const oldest = data?.[0]?.created_at ? new Date(data[0].created_at as string).getTime() : Date.now();
      return { ok: false, remaining: 0, retryAfterSec: Math.max(1, Math.ceil((oldest + windowMs - Date.now()) / 1000)), durable: true };
    }
    await s.from("public_demo_requests").insert({ kind, ip_hash: h, agent_key: extra.agentKey ?? null });
    return { ok: true, remaining: max - (count ?? 0) - 1, retryAfterSec: 0, durable: true };
  } catch (e) {
    if (missing(e)) tableMissing = true;
    else console.warn("[rateLimit] durable guard failed, using memory:", (e as Error)?.message);
    return { ...rateLimit(`${kind}:${ip}`, max, windowMs), durable: false };
  }
}

/** How many public requests of a kind since a moment (all visitors); null when the table is absent. */
export async function publicCountSince(kind: "call" | "match" | "summary", since: Date): Promise<number | null> {
  if (tableMissing) return null;
  try {
    const { count, error } = await (await db()).from("public_demo_requests").select("id", { count: "exact", head: true }).eq("kind", kind).gte("created_at", since.toISOString());
    if (error) throw error;
    return count ?? 0;
  } catch (e) {
    if (missing(e)) tableMissing = true;
    return null;
  }
}
