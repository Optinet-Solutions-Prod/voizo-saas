import { Suspense } from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { BarChart3, Bot, ShieldCheck } from "lucide-react";
import LoginForm from "./LoginForm";

export const metadata: Metadata = {
  title: "Sign in · VOIZO",
  description: "Sign in to the VOIZO console.",
};

// Public sign-in page (the middleware leaves /login open and sends signed-in admins on to ?next=).

const PRIMARY = "#4d90f0";

const POINTS = [
  { icon: Bot, text: "Build and test AI voice agents" },
  { icon: BarChart3, text: "Run campaigns and track every outcome" },
  { icon: ShieldCheck, text: "Compliance checks on every dial" },
];

export default function LoginPage() {
  return (
    <div className="grid min-h-screen lg:grid-cols-[1fr_1.05fr]">
      {/* ── Brand panel (desktop) ── */}
      <aside
        className="relative hidden overflow-hidden lg:flex lg:flex-col lg:justify-between p-12 text-white"
        style={{ background: `linear-gradient(150deg, #1b3a73 0%, #2a58b0 45%, ${PRIMARY} 100%)` }}
      >
        {/* decorative rings */}
        <div aria-hidden className="pointer-events-none absolute -right-40 -top-40 h-[520px] w-[520px] rounded-full border border-white/10" />
        <div aria-hidden className="pointer-events-none absolute -right-24 -top-24 h-[360px] w-[360px] rounded-full border border-white/10" />
        <div aria-hidden className="pointer-events-none absolute -bottom-48 -left-24 h-[480px] w-[480px] rounded-full bg-white/5 blur-3xl" />

        <Link href="/" className="relative flex items-center gap-2.5" aria-label="VOIZO home">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/15 ring-1 ring-white/25 backdrop-blur">
            <span className="text-base font-bold">V</span>
          </span>
          <span className="text-lg font-bold tracking-tight">VOIZO</span>
        </Link>

        <div className="relative max-w-md">
          <h2 className="text-4xl font-bold leading-tight tracking-tight">
            Your AI calling team,
            <br />
            one sign-in away.
          </h2>
          <ul className="mt-10 space-y-4">
            {POINTS.map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-center gap-3 text-white/85">
                <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/12 ring-1 ring-white/20">
                  <Icon size={17} />
                </span>
                {text}
              </li>
            ))}
          </ul>
        </div>

        <p className="relative text-sm text-white/60">© {new Date().getFullYear()} VOIZO</p>
      </aside>

      {/* ── Form ── */}
      <main className="relative flex items-center justify-center px-4 py-12 sm:px-8">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-[1]"
          style={{ background: `radial-gradient(45% 40% at 50% 30%, ${PRIMARY}1f, transparent 70%)` }}
        />
        <div className="w-full max-w-sm">
          {/* mobile logo */}
          <Link href="/" className="mb-10 flex items-center justify-center gap-2.5 lg:hidden" aria-label="VOIZO home">
            <span
              className="flex h-10 w-10 items-center justify-center rounded-xl"
              style={{ background: "linear-gradient(145deg,#4d90f0,#3a6fd0)", boxShadow: "0 2px 10px rgba(77,144,240,.35)" }}
            >
              <span className="text-base font-bold text-white">V</span>
            </span>
            <span className="text-lg font-bold tracking-tight text-[var(--text-1)]">VOIZO</span>
          </Link>

          <div className="rounded-3xl border border-[var(--border)] bg-[var(--bg-card)] p-7 shadow-2xl sm:p-8">
            <h1 className="text-2xl font-bold tracking-tight text-[var(--text-1)]">Welcome back</h1>
            <p className="mt-1.5 text-sm text-[var(--text-3)]">Sign in to your VOIZO console.</p>
            <Suspense fallback={<div className="mt-7 h-[228px]" />}>
              <LoginForm />
            </Suspense>
          </div>

          <p className="mt-6 text-center text-xs text-[var(--text-3)]">
            New to VOIZO?{" "}
            <Link href="/signup" className="font-medium text-[var(--text-1)] hover:underline">Create an account</Link>
          </p>
        </div>
      </main>
    </div>
  );
}
