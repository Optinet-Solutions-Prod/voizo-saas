import { Suspense } from "react";
import Link from "next/link";
import type { Metadata } from "next";
import SignupForm from "./SignupForm";

export const metadata: Metadata = {
  title: "Create account · VOIZO",
  description: "Create your VOIZO account.",
};

const PRIMARY = "#4d90f0";

// Public sign-up. After confirming their email the person lands on /onboarding, where they
// either create an organization or accept the invite that brought them here.
export default function SignupPage() {
  return (
    <main className="relative flex min-h-screen items-center justify-center px-4 py-12 sm:px-8">
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-[1]" style={{ background: `radial-gradient(45% 40% at 50% 30%, ${PRIMARY}1f, transparent 70%)` }} />
      <div className="w-full max-w-sm">
        <Link href="/" className="mb-10 flex items-center justify-center gap-2.5" aria-label="VOIZO home">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl" style={{ background: "linear-gradient(145deg,#4d90f0,#3a6fd0)", boxShadow: "0 2px 10px rgba(77,144,240,.35)" }}>
            <span className="text-base font-bold text-white">V</span>
          </span>
          <span className="text-lg font-bold tracking-tight text-[var(--text-1)]">VOIZO</span>
        </Link>
        <div className="rounded-3xl border border-[var(--border)] bg-[var(--bg-card)] p-7 shadow-2xl sm:p-8">
          <h1 className="text-2xl font-bold tracking-tight text-[var(--text-1)]">Create your account</h1>
          <p className="mt-1.5 text-sm text-[var(--text-3)]">Then create an organization or join one you were invited to.</p>
          <Suspense fallback={<div className="mt-7 h-[300px]" />}>
            <SignupForm />
          </Suspense>
        </div>
        <p className="mt-6 text-center text-xs text-[var(--text-3)]">
          Already have an account?{" "}
          <Link href="/login" className="font-medium text-[var(--text-1)] hover:underline">Sign in</Link>
        </p>
      </div>
    </main>
  );
}
