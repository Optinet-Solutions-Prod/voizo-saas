import { Suspense } from "react";
import Link from "next/link";
import type { Metadata } from "next";
import LoginForm from "./LoginForm";
import MarketingLogo from "@/components/MarketingLogo";
import { MARKETING_SHELL } from "@/lib/marketingFonts";

export const metadata: Metadata = {
  title: "Log in · VOIZO",
  description: "Log in to the VOIZO console.",
};

// Public sign-in page (the middleware leaves /login open and sends signed-in admins on to ?next=).
// Restyled after console.deepgram.com/login (Chris, 2026-10-01): a black ground, the wordmark
// centred above one narrow card, flat inputs, a single green button and the sign-up link below.
// Dark only, like the reference; the theme is the .dg-site scope in globals.css.

export default function LoginPage() {
  return (
    <div className={`${MARKETING_SHELL} flex min-h-screen flex-col bg-[var(--bg-panel)] text-[var(--text-1)]`}>
      <header className="flex justify-center px-4 pb-8 pt-14">
        <MarketingLogo size="lg" />
      </header>

      <main className="flex flex-1 items-start justify-center px-4 pb-16">
        <div className="w-full max-w-[400px]">
          <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-7 sm:p-8">
            <h1 className="dg-display text-2xl">Log in</h1>
            <p className="mt-1.5 text-sm text-[var(--text-3)]">Welcome back to your VOIZO console.</p>
            <Suspense fallback={<div className="mt-7 h-[212px]" />}>
              <LoginForm />
            </Suspense>
          </div>
          <p className="mt-6 text-center text-sm text-[var(--text-3)]">
            Don&apos;t have an account?{" "}
            <Link href="/signup" className="font-medium text-[var(--accent)] hover:underline">Sign up</Link>
          </p>
        </div>
      </main>

      <footer className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 px-4 pb-8 text-xs text-[var(--text-4)]">
        <p>© {new Date().getFullYear()} VOIZO</p>
        <Link href="/agents" className="transition-colors hover:text-[var(--text-2)]">Agents</Link>
        <Link href="/pricing" className="transition-colors hover:text-[var(--text-2)]">Pricing</Link>
      </footer>
    </div>
  );
}
