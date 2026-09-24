import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

// Server-only Supabase clients. NEVER import this from client components.
//
// `supabaseAdmin` (the name every route already imports) is now tenant-aware:
//   * On a request made by a signed-in user, it sends THAT user's JWT, so the
//     row-level policies from supabase-migration-saas-tenancy.sql scope every
//     query to the user's organization. No call site had to change.
//   * With no user (cron, webhooks, scripts) it sends the service role key and
//     bypasses RLS, exactly as before.
//   * Until the tenancy migration has been applied (no `organizations` table)
//     it always uses the service role, so the app keeps working single-tenant.
//
// `supabaseService` is the plain service-role client for the few places that
// must act across organizations on purpose (auth admin, tenant bootstrap).

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!url) throw new Error("FATAL: NEXT_PUBLIC_SUPABASE_URL is not set");
if (!serviceKey) throw new Error("FATAL: SUPABASE_SERVICE_ROLE_KEY is not set");

export const supabaseService: SupabaseClient = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// ── Is the tenancy schema in place? ─────────────────────────────────────────
// Probed once per server instance (re-probed every minute while it is missing,
// so the app switches over by itself right after the migration is run).
let provisioned: boolean | null = null;
let probedAt = 0;

export async function tenancyProvisioned(): Promise<boolean> {
  if (provisioned === true) return true;
  if (provisioned === false && Date.now() - probedAt < 60_000) return false;
  probedAt = Date.now();
  try {
    // A GET, not HEAD: PostgREST answers HEAD on a missing table with 204 and no error body.
    const { error } = await supabaseService.from("organizations").select("id").limit(1);
    provisioned = !error;
  } catch {
    provisioned = false;
  }
  return provisioned;
}

// ── The signed-in user's access token for the current request ───────────────
// Read from the session cookies @supabase/ssr writes (the middleware refreshes
// them on every request). Outside a request scope, or signed out, → null.
export async function requestAccessToken(): Promise<string | null> {
  if (!anonKey) return null;
  let store: Awaited<ReturnType<typeof cookies>>;
  try {
    store = await cookies();
  } catch {
    return null; // not inside a request (build step, script)
  }
  const all = store.getAll();
  if (!all.some((c) => c.name.startsWith("sb-") && c.name.includes("-auth-token"))) return null;
  const client = createServerClient(url!, anonKey, {
    cookies: { getAll: () => all, setAll: () => {} },
  });
  const {
    data: { session },
  } = await client.auth.getSession();
  return session?.access_token ?? null;
}

// ── Tenant-aware client ─────────────────────────────────────────────────────
// A custom fetch swaps the Authorization header per request. supabase-js sets
// `Authorization: Bearer <key>` itself; we replace it with the user's JWT when
// there is one and the tenancy schema exists.
async function tenantFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers);
  if (await tenancyProvisioned()) {
    const token = await requestAccessToken();
    if (token) {
      headers.set("Authorization", `Bearer ${token}`);
      // apikey stays the service key: PostgREST derives the role from the Bearer token.
    }
  }
  return fetch(input, { ...init, headers });
}

export const supabaseAdmin: SupabaseClient = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
  global: { fetch: tenantFetch },
});
