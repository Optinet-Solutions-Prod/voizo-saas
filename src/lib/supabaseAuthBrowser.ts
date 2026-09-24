"use client";

import { createBrowserClient } from "@supabase/ssr";

// Browser client for AUTH ONLY (sign in, sign out, reading the signed-in user). It keeps the
// session in cookies so the middleware can see it.
//
// Data queries keep using the plain anon client in ./supabase: its RLS policies were written
// for the anon role, and sending the user's JWT would switch those queries to "authenticated".
export function supabaseAuthBrowser() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
