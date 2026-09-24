import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { safeNextPath } from "@/lib/auth";

// Email-confirmation landing: Supabase redirects here with ?code=…; we exchange it for a
// session (cookies) and continue to ?next= (normally /onboarding or an invite page).
export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const next = safeNextPath(request.nextUrl.searchParams.get("next")) === "/dashboard" ? "/onboarding" : safeNextPath(request.nextUrl.searchParams.get("next"));
  const target = new URL(next, request.url);
  const response = NextResponse.redirect(target);
  if (!code) return response;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const supabase = createServerClient(url, anon, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list) => list.forEach(({ name, value, options }) => response.cookies.set(name, value, options)),
    },
  });
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    const login = new URL("/login", request.url);
    login.searchParams.set("error", "confirm_failed");
    return NextResponse.redirect(login);
  }
  return response;
}
