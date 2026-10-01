"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

// Settings → Platform: what every organization has cost us (Vapi, OpenAI, ElevenLabs) recently.

export interface OrgCostRow {
  org_id: string | null; org_name: string; org_slug: string | null; plan: string | null;
  calls: number; demo_calls: number; vapi_usd: number; openai_usd: number; other_usd: number; total_usd: number;
}

const usd = (n: number | string | null | undefined) => `$${Number(n ?? 0).toFixed(2)}`;

export default function OrgCostsCard() {
  const [days, setDays] = useState(30);
  const [rows, setRows] = useState<OrgCostRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // load() awaits the network before setting state — not a synchronous set-state-in-effect.
  useEffect(() => {
    let alive = true;
    const load = async () => {
      setError(null);
      try {
        const r = await fetch(`/api/admin/org-costs?days=${days}`, { cache: "no-store" });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? "Could not load costs");
        if (alive) setRows(j.rows as OrgCostRow[]);
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : "Could not load costs");
      }
    };
    void load();
    return () => { alive = false; };
  }, [days]);

  const total = (rows ?? []).reduce((s, r) => s + Number(r.total_usd ?? 0), 0);

  return (
    <section className="rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-[var(--text-1)]">Cost per organization</h2>
          <p className="mt-0.5 text-xs text-[var(--text-3)]">Campaign calls, demo calls and AI features. Vapi and OpenAI from their reports; ElevenLabs estimated from characters spoken.</p>
        </div>
        <div className="flex items-center gap-2 text-xs">
          {[7, 30, 90].map((d) => (
            <button key={d} type="button" onClick={() => setDays(d)} className={`rounded-lg border px-2.5 py-1 ${days === d ? "border-primary/50 bg-primary/10 text-primary" : "border-[var(--border)] text-[var(--text-3)] hover:text-[var(--text-1)]"}`}>{d} days</button>
          ))}
        </div>
      </div>
      {error ? (
        <p className="mt-3 text-sm text-red-300">{error}</p>
      ) : !rows ? (
        <p className="mt-3 flex items-center gap-2 text-sm text-[var(--text-3)]"><Loader2 size={14} className="animate-spin" /> Loading…</p>
      ) : rows.length === 0 ? (
        <p className="mt-3 text-sm text-[var(--text-3)]">No spend recorded in this window.</p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-[var(--text-3)]">
                <th className="pb-2 font-medium">Organization</th><th className="pb-2 font-medium">Plan</th>
                <th className="pb-2 text-right font-medium">Calls</th><th className="pb-2 text-right font-medium">Demos</th>
                <th className="pb-2 text-right font-medium">Vapi</th><th className="pb-2 text-right font-medium">OpenAI</th><th className="pb-2 text-right font-medium">ElevenLabs</th><th className="pb-2 text-right font-medium">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {rows.map((r) => (
                <tr key={r.org_id ?? "public"} className="text-[var(--text-2)]">
                  <td className="py-2 font-medium text-[var(--text-1)]">{r.org_name}{r.org_slug ? <span className="ml-1.5 text-[11px] text-[var(--text-4)]">{r.org_slug}</span> : null}</td>
                  <td className="py-2 text-[var(--text-3)]">{r.plan ?? "—"}</td>
                  <td className="py-2 text-right">{r.calls}</td><td className="py-2 text-right">{r.demo_calls}</td>
                  <td className="py-2 text-right">{usd(r.vapi_usd)}</td><td className="py-2 text-right">{usd(r.openai_usd)}</td><td className="py-2 text-right">{usd(r.other_usd)}</td>
                  <td className="py-2 text-right font-semibold text-[var(--text-1)]">{usd(r.total_usd)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr><td colSpan={7} className="pt-2 text-right text-xs text-[var(--text-3)]">All organizations</td><td className="pt-2 text-right font-semibold text-[var(--text-1)]">{usd(total)}</td></tr></tfoot>
          </table>
        </div>
      )}
    </section>
  );
}
