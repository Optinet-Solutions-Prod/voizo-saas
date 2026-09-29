"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, Loader2, Plug, Zap } from "lucide-react";
import { DELIVERY_MODES, type DeliveryMode } from "@/lib/deliveryMode";

// Settings → Integrations, top card: "Agents on the go" (VOIZO's numbers, SIP trunk, SMS, email)
// or "Bring your own" (the org's connected providers). One click, saved to the organization.

const PRIMARY = "#4d90f0";

export default function DeliveryModeCard({ canManage }: { canManage: boolean }) {
  const [mode, setMode] = useState<DeliveryMode | null>(null);
  const [saving, setSaving] = useState<DeliveryMode | null>(null);
  const [error, setError] = useState<string | null>(null);

  // load() awaits the network before setting state — not a synchronous set-state-in-effect.
  useEffect(() => {
    const load = async () => {
      try {
        const r = await fetch("/api/org/delivery-mode", { cache: "no-store" });
        const j = await r.json();
        if (r.ok) setMode(j.mode as DeliveryMode);
      } catch { /* leave unknown */ }
    };
    void load();
  }, []);

  async function choose(next: DeliveryMode) {
    if (!canManage || next === mode || saving) return;
    setError(null);
    setSaving(next);
    try {
      const r = await fetch("/api/org/delivery-mode", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode: next }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "Could not save");
      setMode(j.mode as DeliveryMode);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save");
    } finally {
      setSaving(null);
    }
  }

  return (
    <section className="rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-5">
      <h2 className="text-sm font-semibold text-[var(--text-1)]">How do you want to run calls?</h2>
      <p className="mt-1 text-xs text-[var(--text-3)]">Switch any time. Campaigns pick up the change on their next call.</p>
      <div role="radiogroup" aria-label="Delivery mode" className="mt-4 grid gap-3 md:grid-cols-2">
        {DELIVERY_MODES.map((m) => {
          const on = mode === m.value;
          const Icon = m.value === "on_the_go" ? Zap : Plug;
          return (
            <button key={m.value} type="button" role="radio" aria-checked={on} disabled={!canManage || saving !== null} onClick={() => choose(m.value)}
              className={`relative rounded-2xl border p-4 text-left transition disabled:cursor-default ${on ? "border-primary/60 bg-primary/10" : "border-[var(--border)] bg-[var(--bg-elevated)] hover:border-[var(--border-2)]"}`}>
              <div className="flex items-center gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-white" style={{ background: m.value === "on_the_go" ? PRIMARY : "linear-gradient(145deg,#6b5cd6,#4d90f0)" }}><Icon size={16} /></span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-[var(--text-1)]">{m.label}</p>
                  <p className="text-[11px] text-[var(--text-3)]">{m.tagline}</p>
                </div>
                {saving === m.value ? <Loader2 size={16} className="animate-spin text-[var(--text-3)]" /> : on ? <CheckCircle2 size={18} className="text-primary" /> : mode === null ? <Loader2 size={14} className="animate-spin text-[var(--text-4)]" /> : null}
              </div>
              <p className="mt-3 text-xs leading-relaxed text-[var(--text-2)]">{m.body}</p>
            </button>
          );
        })}
      </div>
      {error && <p role="alert" className="mt-3 text-xs text-red-300">{error}</p>}
    </section>
  );
}
