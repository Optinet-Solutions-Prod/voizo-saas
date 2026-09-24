"use client";

import { FormEvent, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AlertCircle, ArrowRight, Eye, EyeOff, Loader2, Lock, Mail } from "lucide-react";
import { supabaseAuthBrowser } from "@/lib/supabaseAuthBrowser";
import { isAdmin, safeNextPath } from "@/lib/auth";

const PRIMARY = "#4d90f0";

const NOT_ADMIN = "This account doesn't have access to the console.";

export default function LoginForm() {
  const params = useSearchParams();
  const next = safeNextPath(params.get("next"));

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(params.get("error") === "not_admin" ? NOT_ADMIN : null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const supabase = supabaseAuthBrowser();
    const { data, error: signInError } = await supabase.auth.signInWithPassword({
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
    if (!isAdmin(data.user)) {
      await supabase.auth.signOut();
      setLoading(false);
      setError(NOT_ADMIN);
      return;
    }
    // Full navigation (not router.push) so the middleware sees the new session cookies and
    // every server component renders for the signed-in user.
    window.location.assign(next);
  }

  const inputWrap =
    "flex items-center gap-2.5 rounded-xl border border-[var(--border-2)] bg-[var(--bg-elevated)] px-3.5 transition focus-within:border-[#4d90f0] focus-within:ring-4 focus-within:ring-[#4d90f0]/15";
  const inputCls =
    "h-11 w-full bg-transparent text-sm text-[var(--text-1)] placeholder:text-[var(--text-4)] outline-none";

  return (
    <form onSubmit={onSubmit} className="mt-7 space-y-4" noValidate>
      {error && (
        <div role="alert" className="flex items-start gap-2.5 rounded-xl border border-red-500/25 bg-red-500/10 px-3.5 py-3 text-sm text-red-400">
          <AlertCircle size={16} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div>
        <label htmlFor="email" className="mb-1.5 block text-xs font-medium text-[var(--text-2)]">Email</label>
        <div className={inputWrap}>
          <Mail size={16} className="shrink-0 text-[var(--text-3)]" />
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
          <Lock size={16} className="shrink-0 text-[var(--text-3)]" />
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
        className="group mt-2 flex h-11 w-full items-center justify-center gap-2 rounded-xl text-sm font-semibold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
        style={{ background: PRIMARY, boxShadow: `0 8px 24px ${PRIMARY}33` }}
      >
        {loading ? (
          <>
            <Loader2 size={16} className="animate-spin" /> Signing in…
          </>
        ) : (
          <>
            Sign in <ArrowRight size={16} className="transition-transform group-hover:translate-x-0.5" />
          </>
        )}
      </button>
    </form>
  );
}
