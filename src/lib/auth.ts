// Shared auth rules for the console (Supabase Auth, email + password).
//
// Any signed-in user may enter the console; what they can see is decided by their
// organization membership (src/lib/tenant.ts + the row-level policies). A user with no
// organization is sent to /onboarding by TenantGate.
//
// app_metadata.role === "admin" marks PLATFORM staff (VOIZO operators). app_metadata is
// writable only with the service role key, so nobody can grant it to themselves.
import type { User } from "@supabase/supabase-js";

export function isPlatformAdmin(user: Pick<User, "app_metadata"> | null | undefined): boolean {
  return user?.app_metadata?.role === "admin";
}

/** @deprecated kept for older call sites; means platform admin, not "may sign in". */
export const isAdmin = isPlatformAdmin;

/** Pages that never need a session. Exact matches, plus the prefixes below. */
export const PUBLIC_PAGES = new Set(["/", "/login", "/signup", "/pricing", "/agents"]);
export const PUBLIC_PAGE_PREFIXES = ["/invite/", "/auth/"];

export function isPublicPage(pathname: string): boolean {
  return PUBLIC_PAGES.has(pathname) || PUBLIC_PAGE_PREFIXES.some((p) => pathname.startsWith(p));
}

/** Signed-in pages that must NOT require an organization (the place you get one). */
export const NO_ORG_PAGES = new Set(["/onboarding"]);

/**
 * Where to send the user after login. Only same-origin paths are allowed: "/x" is fine, but
 * "//evil.com" and "/\evil.com" (both read as protocol-relative URLs by browsers) and absolute
 * URLs fall back to the dashboard, so ?next= can't be used as an open redirect.
 */
export function safeNextPath(next: string | null | undefined): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) {
    return "/dashboard";
  }
  if (next === "/login" || next.startsWith("/login?") || next === "/signup" || next.startsWith("/signup?")) return "/dashboard";
  return next;
}
