import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { isPublicPage, safeNextPath } from "@/lib/auth";

/**
 * Session middleware — Supabase Auth (email + password).
 *
 * Every request except the public paths below needs a signed-in user:
 *   - pages   → redirect to /login?next=<path>
 *   - /api/*  → 401 JSON (a redirect would hand fetch() the login page's HTML)
 * Which ORGANIZATION the user may see is not decided here: TenantGate (layout) sends users
 * without one to /onboarding, and the database's row-level policies scope every query.
 *
 * Public paths:
 *   /, /login, /signup, /pricing, /agents, /invite/*   — marketing + sign-in + invites
 *   /api/webhooks/*               — signed by Vapi/Mobivate-side
 *                                   (HMAC, x-vapi-secret, reference UUID)
 *   /api/cron/*                   — Bearer CRON_SECRET (Vercel-injected)
 *   /api/lab/webhook              — x-vapi-secret (VOZ-186; route carries its own check)
 *   /api/public/*                 — read-only marketing data (agent catalog, pricing)
 *   /api/invites/*                — invite preview/accept (route checks the session itself)
 *   static assets                 — excluded by the matcher
 *
 * The session lives in cookies written by @supabase/ssr. getUser() verifies the token with the
 * Auth server (not just decoding the cookie) and refreshes it when needed; refreshed cookies are
 * copied onto whatever response we return, redirects included. The request's pathname is passed
 * down as the `x-pathname` header for server components (TenantGate).
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
  "/api/public/",
  "/api/invites/",
];

function isPublicApiPath(pathname: string): boolean {
  return PUBLIC_PATH_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

export async function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  // Server components read the path from this header (TenantGate).
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-pathname", pathname);

  // ── 1. Routes with their own auth — no session lookup at all ──
  if (isPublicApiPath(pathname)) {
    return NextResponse.next({ request: { headers: requestHeaders } });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    // Fail closed: without Supabase config nobody can be authenticated.
    console.error("[middleware] NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY not set — refusing to serve");
    return new NextResponse("Auth not configured.", { status: 503 });
  }

  // ── 2. Resolve the session (and let Supabase refresh its cookies) ──
  let response = NextResponse.next({ request: { headers: requestHeaders } });
  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request: { headers: requestHeaders } });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Redirects must carry any refreshed session cookies too.
  const redirectTo = (target: URL) => {
    const res = NextResponse.redirect(target);
    response.cookies.getAll().forEach((c) => res.cookies.set(c));
    return res;
  };

  // ── 3. Public pages ──
  if (isPublicPage(pathname)) {
    // Already signed in → skip the sign-in / sign-up forms.
    if ((pathname === "/login" || pathname === "/signup") && user) {
      const next = safeNextPath(request.nextUrl.searchParams.get("next"));
      return redirectTo(new URL(next, request.url));
    }
    return response;
  }

  // ── 4. Everything else needs a session ──
  if (user) return response;

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const login = new URL("/login", request.url);
  login.searchParams.set("next", pathname + search);
  return redirectTo(login);
}

export const config = {
  /**
   * Matcher excludes static asset paths so the middleware doesn't run on
   * every JS chunk / image fetch (public/ images and audio included, so the
   * landing, login and agent pages can use them). The public-path checks
   * inside the middleware then handle the API-route exemptions.
   */
  matcher: [
    "/((?!_next/static|_next/image|favicon\\.ico|favicon\\.svg|icon(?:\\.png)?$|robots\\.txt|.*\\.(?:svg|png|jpg|jpeg|gif|webp|mp3|wav|ogg)$).*)",
  ],
};
