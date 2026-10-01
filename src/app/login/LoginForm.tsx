"use client";

import { FormEvent, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AlertCircle, Eye, EyeOff, Loader2 } from "lucide-react";
import { supabaseAuthBrowser } from "@/lib/supabaseAuthBrowser";
import { safeNextPath } from "@/lib/auth";

// Email + password sign-in. Flat, icon-less inputs and one accent button, after the reference
// console's login (2026-10-01); colors come from the .dg-site theme the page wraps this in.

export default function LoginForm() {
  const params = useSearchParams();
  const next = safeNextPath(params.get("next"));

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(params.get("error") === "confirm_failed" ? "That confirmation link is invalid or has expired. Log in, or create the account again." : null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const supabase = supabaseAuthBrowser();
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });

    if (signInError) {
      setLoading(false);
      setError(
        signInError.message === "Invalid login credentials"
          ? "That email and password don't match."
          : signInError.message,
      );
      return;
    }
    // Full navigation (not router.push) so the middleware sees the new session cookies and
    // every server component renders for the signed-in user.
    window.location.assign(next);
  }

  const inputWrap =
    "flex items-center gap-2 rounded-md border border-[var(--border-2)] bg-[var(--bg-panel)] px-3.5 transition focus-within:border-[var(--accent)] focus-within:ring-2 focus-within:ring-[var(--accent)]/25";
  const inputCls =
    "h-11 w-full bg-transparent text-sm text-[var(--text-1)] placeholder:text-[var(--text-4)] outline-none";

  return (
    <form onSubmit={onSubmit} className="mt-7 space-y-4" noValidate>
      {error && (
        <div role="alert" className="flex items-start gap-2.5 rounded-md border border-red-500/25 bg-red-500/10 px-3.5 py-3 text-sm text-red-400">
          <AlertCircle size={16} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div>
        <label htmlFor="email" className="mb-1.5 block text-xs font-medium text-[var(--text-2)]">Email</label>
        <div className={inputWrap}>
          <input
            id="email"
            type="email"
            autoComplete="email"
            required
            autoFocus
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@company.com"
            className={inputCls}
          />
        </div>
      </div>

      <div>
        <label htmlFor="password" className="mb-1.5 block text-xs font-medium text-[var(--text-2)]">Password</label>
        <div className={inputWrap}>
          <input
            id="password"
            type={showPassword ? "text" : "password"}
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            className={inputCls}
          />
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            aria-label={showPassword ? "Hide password" : "Show password"}
            className="shrink-0 text-[var(--text-3)] transition hover:text-[var(--text-1)]"
          >
            {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        </div>
      </div>

      <button
        type="submit"
        disabled={loading || !email || !password}
        className="dg-btn dg-btn-primary mt-2 w-full disabled:cursor-not-allowed disabled:opacity-60"
      >
        {loading ? (
          <>
            <Loader2 size={16} className="animate-spin" /> Logging in…
          </>
        ) : (
          "Log in"
        )}
      </button>
    </form>
  );
}
