"use client";

import { FormEvent, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AlertCircle, ArrowRight, CheckCircle2, Eye, EyeOff, Loader2, Lock, Mail } from "lucide-react";
import { supabaseAuthBrowser } from "@/lib/supabaseAuthBrowser";
import { safeNextPath } from "@/lib/auth";

const PRIMARY = "#4d90f0";

export default function SignupForm() {
  const params = useSearchParams();
  // An invite link passes ?next=/invite/<token> so the person lands back on it after sign-up.
  const next = safeNextPath(params.get("next"));
  const presetEmail = params.get("email") ?? "";

  const [email, setEmail] = useState(presetEmail);
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsConfirm, setNeedsConfirm] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) { setError("Use at least 8 characters for the password."); return; }
    setLoading(true);
    const supabase = supabaseAuthBrowser();
    const { data, error: err } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next === "/dashboard" ? "/onboarding" : next)}` },
    });
    if (err) { setLoading(false); setError(err.message); return; }
    // With email confirmation on, there is no session yet: tell them to check their inbox.
    if (!data.session) { setLoading(false); setNeedsConfirm(true); return; }
    window.location.assign(next === "/dashboard" ? "/onboarding" : next);
  }

  if (needsConfirm) {
    return (
      <div className="mt-7 rounded-2xl border border-emerald-500/25 bg-emerald-500/10 p-5 text-sm text-[var(--text-1)]">
        <div className="flex items-start gap-3">
          <CheckCircle2 size={20} className="mt-0.5 shrink-0 text-emerald-400" />
          <div>
            <p className="font-semibold">Check your email</p>
            <p className="mt-1 text-[var(--text-2)]">
              We sent a confirmation link to <span className="font-medium text-[var(--text-1)]">{email}</span>. Open it to activate your account; you&apos;ll then be taken straight to the next step.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const inputWrap = "flex items-center gap-2.5 rounded-xl border border-[var(--border-2)] bg-[var(--bg-elevated)] px-3.5 transition focus-within:border-[#4d90f0] focus-within:ring-4 focus-within:ring-[#4d90f0]/15";
  const inputCls = "h-11 w-full bg-transparent text-sm text-[var(--text-1)] placeholder:text-[var(--text-4)] outline-none";

  return (
    <form onSubmit={onSubmit} className="mt-7 space-y-4" noValidate>
      {error && (
        <div role="alert" className="flex items-start gap-2.5 rounded-xl border border-red-500/25 bg-red-500/10 px-3.5 py-3 text-sm text-red-400">
          <AlertCircle size={16} className="mt-0.5 shrink-0" /><span>{error}</span>
        </div>
      )}
      <div>
        <label htmlFor="email" className="mb-1.5 block text-xs font-medium text-[var(--text-2)]">Work email</label>
        <div className={inputWrap}>
          <Mail size={16} className="shrink-0 text-[var(--text-3)]" />
          <input id="email" type="email" autoComplete="email" required autoFocus={!presetEmail} readOnly={!!presetEmail} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" className={inputCls} />
        </div>
      </div>
      <div>
        <label htmlFor="password" className="mb-1.5 block text-xs font-medium text-[var(--text-2)]">Password</label>
        <div className={inputWrap}>
          <Lock size={16} className="shrink-0 text-[var(--text-3)]" />
          <input id="password" type={show ? "text" : "password"} autoComplete="new-password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 8 characters" className={inputCls} />
          <button type="button" onClick={() => setShow((v) => !v)} aria-label={show ? "Hide password" : "Show password"} className="shrink-0 text-[var(--text-3)] transition hover:text-[var(--text-1)]">
            {show ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        </div>
      </div>
      <button type="submit" disabled={loading || !email || !password} className="group mt-2 flex h-11 w-full items-center justify-center gap-2 rounded-xl text-sm font-semibold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60" style={{ background: PRIMARY, boxShadow: `0 8px 24px ${PRIMARY}33` }}>
        {loading ? (<><Loader2 size={16} className="animate-spin" /> Creating account…</>) : (<>Create account <ArrowRight size={16} className="transition-transform group-hover:translate-x-0.5" /></>)}
      </button>
      <p className="text-center text-[11px] leading-relaxed text-[var(--text-4)]">By continuing you agree to use VOIZO only for calls your recipients have consented to receive.</p>
    </form>
  );
}
