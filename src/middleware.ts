import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { isAdmin, safeNextPath } from "@/lib/auth";

/**
 * Session middleware — Supabase Auth (email + password), replacing the old HTTP Basic Auth.
 *
 * Every request except the public paths below needs a signed-in user whose
 * app_metadata.role is "admin" (see src/lib/auth.ts for why app_metadata):
 *   - pages   → redirect to /login?next=<path>
 *   - /api/*  → 401 JSON (a redirect would hand fetch() the login page's HTML)
 *
 * Public paths:
 *   /, /login                     — landing + sign-in pages
 *   /api/webhooks/*               — signed by Vapi/Mobivate-side
 *                                   (HMAC, x-vapi-secret, reference UUID)
 *   /api/cron/*                   — Bearer CRON_SECRET (Vercel-injected)
 *   /api/lab/webhook              — x-vapi-secret (VOZ-186; route carries its own check)
 *   static assets                 — excluded by the matcher
 *
 * The session lives in cookies written by @supabase/ssr. getUser() verifies the token with the
 * Auth server (not just decoding the cookie) and refreshes it when needed; refreshed cookies are
 * copied onto whatever response we return, redirects included.
 */

// NOTE: every entry is matched with startsWith(), so an entry WITHOUT a trailing
// slash makes every sibling path sharing that prefix public too. Keep the trailing
// slash on directory-style prefixes. (`/api/freeswitch/originate` was removed with
// the route in VOZ-363 — it had no trailing slash, so it also exposed any future
// `/api/freeswitch/originate*` path.)
const PUBLIC_PATH_PREFIXES = [
  "/api/webhooks/",
  "/api/cron/",
  "/api/lab/webhook",
];

// Exact-match public pages.
const PUBLIC_PAGES = new Set(["/", "/login"]);

function isPublicApiPath(pathname: string): boolean {
  return PUBLIC_PATH_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

export async function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  // ── 1. Routes with their own auth — no session lookup at all ──
  if (isPublicApiPath(pathname)) {
    return NextResponse.next();
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    // Fail closed: without Supabase config nobody can be authenticated.
    console.error("[middleware] NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY not set — refusing to serve");
    return new NextResponse("Auth not configured.", { status: 503 });
  }

  // ── 2. Resolve the session (and let Supabase refresh its cookies) ──
  let response = NextResponse.next({ request });
  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const admin = isAdmin(user);

  // Redirects must carry any refreshed session cookies too.
  const redirectTo = (target: URL) => {
    const res = NextResponse.redirect(target);
    response.cookies.getAll().forEach((c) => res.cookies.set(c));
    return res;
  };

  // ── 3. Public pages ──
  if (PUBLIC_PAGES.has(pathname)) {
    // Already signed in → skip the login form.
    if (pathname === "/login" && admin) {
      const next = safeNextPath(request.nextUrl.searchParams.get("next"));
      return redirectTo(new URL(next, request.url));
    }
    return response;
  }

  // ── 4. Everything else needs an admin session ──
  if (admin) return response;

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const login = new URL("/login", request.url);
  login.searchParams.set("next", pathname + search);
  // Signed in, but not an admin: say so on the login page instead of looping silently.
  if (user) login.searchParams.set("error", "not_admin");
  return redirectTo(login);
}

export const config = {
  /**
   * Matcher excludes static asset paths so the middleware doesn't run on
   * every JS chunk / image fetch (public/ images included, so the landing and
   * login pages can use them). The public-path checks inside the middleware
   * then handle the API-route exemptions.
   */
  matcher: [
    "/((?!_next/static|_next/image|favicon\\.ico|favicon\\.svg|icon(?:\\.png)?$|robots\\.txt|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
