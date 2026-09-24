"use client";

import { FormEvent, useState } from "react";
import { AlertCircle, ArrowRight, Building2, Loader2, LogOut, Mail } from "lucide-react";
import { supabaseAuthBrowser } from "@/lib/supabaseAuthBrowser";

const PRIMARY = "#4d90f0";

interface Props {
  email: string;
  invites: { token: string; orgName: string; role: string }[];
  provisioned: boolean;
}

export default function OnboardingClient({ email, invites, provisioned }: Props) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function accept(token: string) {
    setError(null); setBusy(token);
    const r = await fetch(`/api/invites/${token}`, { method: "POST" });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { setBusy(null); setError(j.error ?? "Could not accept the invite"); return; }
    window.location.assign("/dashboard");
  }

  async function create(e: FormEvent) {
    e.preventDefault();
    setError(null); setBusy("create");
    const r = await fetch("/api/org/create", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { setBusy(null); setError(j.error ?? "Could not create the organization"); return; }
    window.location.assign("/dashboard?welcome=1");
  }

  async function signOut() {
    await supabaseAuthBrowser().auth.signOut();
    window.location.assign("/login");
  }

  const card = "rounded-3xl border border-[var(--border)] bg-[var(--bg-card)] p-7 shadow-2xl sm:p-8";

  if (!provisioned) {
    return (
      <div className={card}>
        <h1 className="text-xl font-bold text-[var(--text-1)]">Organizations aren&apos;t switched on yet</h1>
        <p className="mt-2 text-sm text-[var(--text-2)]">The database migration <code className="font-mono text-xs">supabase-migration-saas-tenancy.sql</code> hasn&apos;t been applied. Until then the console runs in single-workspace mode.</p>
        <a href="/dashboard" className="mt-5 inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-white" style={{ background: PRIMARY }}>Continue to the console <ArrowRight size={15} /></a>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {error && (
        <div role="alert" className="flex items-start gap-2.5 rounded-xl border border-red-500/25 bg-red-500/10 px-3.5 py-3 text-sm text-red-400">
          <AlertCircle size={16} className="mt-0.5 shrink-0" /><span>{error}</span>
        </div>
      )}

      {invites.length > 0 && (
        <div className={card}>
          <div className="flex items-center gap-2 text-[var(--text-3)]"><Mail size={16} /><span className="text-xs font-semibold uppercase tracking-[0.12em]">You&apos;re invited</span></div>
          <h1 className="mt-2 text-xl font-bold text-[var(--text-1)]">Join your team</h1>
          <p className="mt-1 text-sm text-[var(--text-2)]">Invitations sent to <span className="font-medium text-[var(--text-1)]">{email}</span>:</p>
          <ul className="mt-4 space-y-2">
            {invites.map((inv) => (
              <li key={inv.token} className="flex items-center justify-between gap-3 rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] px-4 py-3">
                <div>
                  <p className="text-sm font-semibold text-[var(--text-1)]">{inv.orgName}</p>
                  <p className="text-xs text-[var(--text-3)]">as {inv.role}</p>
                </div>
                <button type="button" onClick={() => accept(inv.token)} disabled={busy !== null} className="inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-semibold text-white disabled:opacity-60" style={{ background: PRIMARY }}>
                  {busy === inv.token ? <Loader2 size={14} className="animate-spin" /> : null} Join
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Invited people join their team; only someone with no invite starts a new organization. */}
      {invites.length === 0 && (
        <form onSubmit={create} className={card}>
          <div className="flex items-center gap-2 text-[var(--text-3)]"><Building2 size={16} /><span className="text-xs font-semibold uppercase tracking-[0.12em]">New organization</span></div>
          <h1 className="mt-2 text-xl font-bold text-[var(--text-1)]">Create your organization</h1>
          <p className="mt-1 text-sm text-[var(--text-2)]">Your company or team. You&apos;ll be its owner and can invite people and add brands from Settings.</p>
          <label htmlFor="org" className="mt-6 mb-1.5 block text-xs font-medium text-[var(--text-2)]">Organization name</label>
          <input id="org" autoFocus required minLength={2} maxLength={80} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Acme Marketing" className="h-11 w-full rounded-xl border border-[var(--border-2)] bg-[var(--bg-elevated)] px-3.5 text-sm text-[var(--text-1)] outline-none placeholder:text-[var(--text-4)] focus:border-[#4d90f0] focus:ring-4 focus:ring-[#4d90f0]/15" />
          <button type="submit" disabled={busy !== null || name.trim().length < 2} className="mt-5 flex h-11 w-full items-center justify-center gap-2 rounded-xl text-sm font-semibold text-white transition hover:brightness-110 disabled:opacity-60" style={{ background: PRIMARY, boxShadow: `0 8px 24px ${PRIMARY}33` }}>
            {busy === "create" ? <Loader2 size={16} className="animate-spin" /> : null} Create organization <ArrowRight size={16} />
          </button>
          <p className="mt-4 text-center text-xs text-[var(--text-4)]">Were you invited by a colleague? Ask them to send the invite to <span className="text-[var(--text-3)]">{email}</span>, then reload this page.</p>
        </form>
      )}

      <div className="text-center">
        <button type="button" onClick={signOut} className="inline-flex items-center gap-1.5 text-xs text-[var(--text-3)] hover:text-[var(--text-1)]">
          <LogOut size={13} /> Sign out ({email})
        </button>
      </div>
    </div>
  );
}
