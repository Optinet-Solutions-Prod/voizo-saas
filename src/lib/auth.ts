// Shared auth rules for the console (Supabase Auth, email + password).
//
// Only users whose app_metadata.role is "admin" may use the console. app_metadata is writable
// only with the service role key, so a user who signs themselves up through the public Auth API
// (anon key) still can't get in. Create admins with the Supabase dashboard or auth.admin API.
import type { User } from "@supabase/supabase-js";

export function isAdmin(user: Pick<User, "app_metadata"> | null | undefined): boolean {
  return user?.app_metadata?.role === "admin";
}

/**
 * Where to send the user after login. Only same-origin paths are allowed: "/x" is fine, but
 * "//evil.com" and "/\evil.com" (both read as protocol-relative URLs by browsers) and absolute
 * URLs fall back to the dashboard, so ?next= can't be used as an open redirect.
 */
export function safeNextPath(next: string | null | undefined): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) {
    return "/dashboard";
  }
  if (next === "/login" || next.startsWith("/login?")) return "/dashboard";
  return next;
}
