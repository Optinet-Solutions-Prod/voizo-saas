"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import type { OrgCostRow } from "./OrgCostsCard";

// Settings → Organization: this organization's own usage and cost for the last 30 days.

const usd = (n: number | string | null | undefined) => `$${Number(n ?? 0).toFixed(2)}`;

export default function OrgUsageCard() {
  const [row, setRow] = useState<OrgCostRow | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  // load() awaits the network before setting state — not a synchronous set-state-in-effect.
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const r = await fetch("/api/org/usage?days=30", { cache: "no-store" });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? "Could not load usage");
        if (alive) setRow((j.row as OrgCostRow | null) ?? null);
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : "Could not load usage");
      }
    };
    void load();
    return () => { alive = false; };
  }, []);

  const tiles = row ? [
    { label: "Campaign calls", value: String(row.calls) },
    { label: "Demo calls", value: String(row.demo_calls) },
    { label: "Calling (Vapi)", value: usd(row.vapi_usd) },
    { label: "AI (OpenAI)", value: usd(row.openai_usd) },
    { label: "Voices (ElevenLabs)", value: usd(row.other_usd) },
    { label: "Total", value: usd(row.total_usd) },
  ] : [];

  return (
    <section className="rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-5">
      <h2 className="text-sm font-semibold text-[var(--text-1)]">Usage &amp; cost · last 30 days</h2>
      <p className="mt-0.5 text-xs text-[var(--text-3)]">Everything this organization used: campaign calls, demo calls, agent matching, call summaries and AI reviews.</p>
      {error ? (
        <p className="mt-3 text-sm text-[var(--text-3)]">{error}</p>
      ) : row === undefined ? (
        <p className="mt-3 flex items-center gap-2 text-sm text-[var(--text-3)]"><Loader2 size={14} className="animate-spin" /> Loading…</p>
      ) : row === null ? (
        <p className="mt-3 text-sm text-[var(--text-3)]">Nothing used yet in this window.</p>
      ) : (
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          {tiles.map((t) => (
            <div key={t.label} className="rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] px-3.5 py-3">
              <p className="text-[11px] uppercase tracking-wide text-[var(--text-3)]">{t.label}</p>
              <p className="mt-1 text-lg font-semibold text-[var(--text-1)]">{t.value}</p>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
