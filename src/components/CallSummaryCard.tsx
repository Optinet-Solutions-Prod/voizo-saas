"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, ClipboardList, Clock, HelpCircle, Loader2, PhoneMissed, XCircle } from "lucide-react";
import type { TranscriptLine } from "@/lib/useVapiWebCall";
import { formatSeconds } from "./LiveCallPanel";

// After a demo call: what the agent achieved, in plain words. Fetches the summary once from
// /api/public/call-summary using the transcript the browser already has.

type Outcome = "agreed" | "declined" | "callback" | "unclear" | "no_conversation";
interface CallSummary { outcome: Outcome; headline: string; summary: string; nextStep: string; highlights: string[] }

const OUTCOME_STYLE: Record<Outcome, { label: string; cls: string; Icon: typeof CheckCircle2 }> = {
  agreed: { label: "Agreed", cls: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300", Icon: CheckCircle2 },
  declined: { label: "Declined", cls: "border-red-500/30 bg-red-500/10 text-red-300", Icon: XCircle },
  callback: { label: "Call back later", cls: "border-amber-500/30 bg-amber-500/10 text-amber-300", Icon: Clock },
  unclear: { label: "No clear outcome", cls: "border-[var(--border)] bg-[var(--bg-elevated)] text-[var(--text-2)]", Icon: HelpCircle },
  no_conversation: { label: "No conversation", cls: "border-[var(--border)] bg-[var(--bg-elevated)] text-[var(--text-2)]", Icon: PhoneMissed },
};

export default function CallSummaryCard({ agentKey, firstName, company, transcript, seconds }: {
  agentKey: string; firstName: string; company: string; transcript: TranscriptLine[]; seconds: number;
}) {
  const [data, setData] = useState<CallSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  // load() awaits the network before setting state — not a synchronous set-state-in-effect.
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const r = await fetch("/api/public/call-summary", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ agentKey, firstName, company, transcript: transcript.map((l) => ({ role: l.role, text: l.text })) }) });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? "Could not summarise the call");
        if (alive) setData(j.summary as CallSummary);
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : "Could not summarise the call");
      }
    };
    void load();
    return () => { alive = false; };
    // The transcript is final once the call has ended; summarise it once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentKey]);

  const o = data ? OUTCOME_STYLE[data.outcome] ?? OUTCOME_STYLE.unclear : null;

  return (
    <section aria-label="Call summary" className="rounded-2xl border border-[var(--border)] bg-[var(--bg-elevated)] p-4">
      <div className="flex items-center gap-2">
        <ClipboardList size={15} className="text-[var(--text-3)]" />
        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--text-3)]">Call summary</p>
        <span className="ml-auto font-mono text-xs text-[var(--text-3)]">{formatSeconds(seconds)}</span>
      </div>
      {error ? (
        <p className="mt-3 text-sm text-[var(--text-3)]">{error}</p>
      ) : !data || !o ? (
        <p className="mt-3 flex items-center gap-2 text-sm text-[var(--text-3)]"><Loader2 size={14} className="animate-spin" /> Writing the summary…</p>
      ) : (
        <>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${o.cls}`}><o.Icon size={11} /> {o.label}</span>
            <p className="text-sm font-semibold text-[var(--text-1)]">{data.headline}</p>
          </div>
          {data.summary && <p className="mt-2 text-sm leading-relaxed text-[var(--text-2)]">{data.summary}</p>}
          {data.highlights.length > 0 && (
            <ul className="mt-2 space-y-1 text-[13px] text-[var(--text-2)]">
              {data.highlights.map((h) => <li key={h} className="flex items-start gap-2"><span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--text-4)]" />{h}</li>)}
            </ul>
          )}
          {data.nextStep && <p className="mt-2 text-[13px] text-[var(--text-3)]"><span className="font-medium text-[var(--text-2)]">Next:</span> {data.nextStep}</p>}
        </>
      )}
    </section>
  );
}
