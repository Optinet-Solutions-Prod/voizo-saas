"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertCircle, ArrowRight, Loader2, Mail } from "lucide-react";

const PRIMARY = "#4d90f0";

interface Preview {
  orgName: string; email: string; role: string; expired: boolean; accepted: boolean;
  signedInAs: string | null; alreadyInOrg: boolean;
}

export default function InviteClient({ token }: { token: string }) {
  const [p, setP] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch(`/api/invites/${token}`).then(async (r) => {
      const j = await r.json().catch(() => ({}));
      if (!r.ok) setError(j.error ?? "This invite link is not valid");
      else setP(j);
    }).catch(() => setError("Could not load the invite"));
  }, [token]);

  async function accept() {
    setBusy(true); setError(null);
    const r = await fetch(`/api/invites/${token}`, { method: "POST" });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { setBusy(false); setError(j.error ?? "Could not accept the invite"); return; }
    window.location.assign("/dashboard?welcome=1");
  }

  const card = "rounded-3xl border border-[var(--border)] bg-[var(--bg-card)] p-7 shadow-2xl sm:p-8";
  const here = `/invite/${token}`;

  if (error && !p) {
    return <div className={card}><div className="flex items-start gap-2.5 text-sm text-red-400"><AlertCircle size={16} className="mt-0.5 shrink-0" />{error}</div><Link href="/login" className="mt-5 inline-block text-sm text-[var(--text-2)] hover:underline">Go to sign in</Link></div>;
  }
  if (!p) return <div className={`${card} flex items-center justify-center text-[var(--text-3)]`}><Loader2 size={18} className="animate-spin" /></div>;

  const btn = "mt-6 flex h-11 w-full items-center justify-center gap-2 rounded-xl text-sm font-semibold text-white transition hover:brightness-110 disabled:opacity-60";

  return (
    <div className={card}>
      <div className="flex items-center gap-2 text-[var(--text-3)]"><Mail size={16} /><span className="text-xs font-semibold uppercase tracking-[0.12em]">Invitation</span></div>
      <h1 className="mt-2 text-xl font-bold text-[var(--text-1)]">Join {p.orgName}</h1>
      <p className="mt-1 text-sm text-[var(--text-2)]">
        You&apos;ve been invited to join <span className="font-medium text-[var(--text-1)]">{p.orgName}</span> on VOIZO as <span className="font-medium text-[var(--text-1)]">{p.role}</span>. This invite is for <span className="font-medium text-[var(--text-1)]">{p.email}</span>.
      </p>

      {p.accepted ? (
        <p className="mt-5 text-sm text-amber-400">This invite has already been used.</p>
      ) : p.expired ? (
        <p className="mt-5 text-sm text-amber-400">This invite has expired. Ask your administrator for a new one.</p>
      ) : p.signedInAs ? (
        p.alreadyInOrg ? (
          <p className="mt-5 text-sm text-amber-400">You&apos;re signed in as {p.signedInAs} and already belong to an organization. Sign out and use the invited account to join {p.orgName}.</p>
        ) : p.signedInAs.toLowerCase() !== p.email.toLowerCase() ? (
          <p className="mt-5 text-sm text-amber-400">You&apos;re signed in as {p.signedInAs}, but this invite was sent to {p.email}. Sign out and sign in with that address.</p>
        ) : (
          <>
            {error && <p className="mt-4 text-sm text-red-400">{error}</p>}
            <button type="button" onClick={accept} disabled={busy} className={btn} style={{ background: PRIMARY }}>
              {busy ? <Loader2 size={16} className="animate-spin" /> : null} Accept and join <ArrowRight size={16} />
            </button>
          </>
        )
      ) : (
        <>
          <Link href={`/signup?next=${encodeURIComponent(here)}&email=${encodeURIComponent(p.email)}`} className={btn} style={{ background: PRIMARY }}>
            Create account and join <ArrowRight size={16} />
          </Link>
          <p className="mt-4 text-center text-xs text-[var(--text-3)]">
            Already have a VOIZO account?{" "}
            <Link href={`/login?next=${encodeURIComponent(here)}`} className="font-medium text-[var(--text-1)] hover:underline">Sign in</Link>
          </p>
        </>
      )}
    </div>
  );
}
