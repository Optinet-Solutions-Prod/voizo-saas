import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { User } from "@supabase/supabase-js";
import { supabaseService, tenancyProvisioned } from "@/lib/supabaseServer";

// Who is making this request, and which organization are they in.
// Server-only (route handlers, server components).

export type OrgRole = "owner" | "admin" | "member";

export interface Brand {
  id: string;
  name: string;
  slug: string;
  color: string | null;
}

export interface Organization {
  id: string;
  name: string;
  slug: string;
  plan: string;
  settings: Record<string, unknown>;
}

export interface Tenant {
  user: User;
  /** null when the user has no organization yet (→ /onboarding). */
  org: Organization | null;
  role: OrgRole | null;
  brands: Brand[];
  /** false until supabase-migration-saas-tenancy.sql has been run: single-tenant mode. */
  provisioned: boolean;
  /** app_metadata.role === "admin" — platform staff, not an organization role. */
  platformAdmin: boolean;
}

export const ROLE_RANK: Record<OrgRole, number> = { member: 0, admin: 1, owner: 2 };

export function canManageOrg(role: OrgRole | null | undefined): boolean {
  return role === "owner" || role === "admin";
}

/** URL-safe slug: "Fortune Play!" → "fortune-play". */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "brand";
}

/** The signed-in user for this request, verified with the Auth server. null when signed out. */
export async function getSessionUser(): Promise<User | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) return null;
  let store: Awaited<ReturnType<typeof cookies>>;
  try {
    store = await cookies();
  } catch {
    return null;
  }
  const client = createServerClient(url, anon, { cookies: { getAll: () => store.getAll(), setAll: () => {} } });
  const {
    data: { user },
  } = await client.auth.getUser();
  return user ?? null;
}

/**
 * The request's tenant. Uses the service role for the lookup (so it works before RLS is in
 * place and never depends on the policies it exists to support).
 */
export async function getTenant(): Promise<Tenant | null> {
  const user = await getSessionUser();
  if (!user) return null;
  const platformAdmin = user.app_metadata?.role === "admin";
  const provisioned = await tenancyProvisioned();
  if (!provisioned) return { user, org: null, role: null, brands: [], provisioned, platformAdmin };

  const { data: membership } = await supabaseService
    .from("organization_members")
    .select("role, organizations(id, name, slug, plan, settings)")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!membership) return { user, org: null, role: null, brands: [], provisioned, platformAdmin };

  const orgRow = (Array.isArray(membership.organizations) ? membership.organizations[0] : membership.organizations) as Organization | null;
  if (!orgRow) return { user, org: null, role: null, brands: [], provisioned, platformAdmin };

  const { data: brands } = await supabaseService
    .from("brands")
    .select("id, name, slug, color")
    .eq("org_id", orgRow.id)
    .order("created_at", { ascending: true });

  return {
    user,
    org: orgRow,
    role: membership.role as OrgRole,
    brands: (brands ?? []) as Brand[],
    provisioned,
    platformAdmin,
  };
}

/** Route-handler guard: 401 when signed out, 403 when the caller can't manage the org, 409 without an org. */
export async function requireTenant(opts: { manage?: boolean } = {}): Promise<
  { ok: true; tenant: Tenant & { org: Organization; role: OrgRole } } | { ok: false; status: number; error: string }
> {
  const tenant = await getTenant();
  if (!tenant) return { ok: false, status: 401, error: "Authentication required" };
  if (!tenant.provisioned) return { ok: false, status: 503, error: "Organizations are not set up yet (tenancy migration not applied)" };
  if (!tenant.org || !tenant.role) return { ok: false, status: 409, error: "You are not in an organization yet" };
  if (opts.manage && !canManageOrg(tenant.role)) return { ok: false, status: 403, error: "Only organization owners and admins can do this" };
  return { ok: true, tenant: tenant as Tenant & { org: Organization; role: OrgRole } };
}
