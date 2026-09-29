"use client";

import { FormEvent, useEffect, useState } from "react";
import { Phone, Sparkles, X } from "lucide-react";
import { loadVisitor, saveVisitor, type VisitorDetails } from "./AgentDemoModal";

// Hero "Try it now": asks for name, business name and what the business does, then hands the
// details to the agents section (custom DOM event), which finds the best-fit agents and scrolls
// them into view. Picking one there opens the call modal, already filled in.

export const DEMO_DETAILS_EVENT = "voizo:demo-details";
const PRIMARY = "#4d90f0";

export default function TryItNowButton({ className, style }: { className?: string; style?: React.CSSProperties }) {
  const [open, setOpen] = useState(false);
  const [v, setV] = useState<VisitorDetails>({ firstName: "", company: "", businessType: "" });

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => { document.body.style.overflow = prev; window.removeEventListener("keydown", onKey); };
  }, [open]);

  function show() {
    setV(loadVisitor());
    setOpen(true);
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    const d = { firstName: v.firstName.trim(), company: v.company.trim(), businessType: v.businessType.trim() };
    saveVisitor(d);
    setOpen(false);
    window.dispatchEvent(new CustomEvent<VisitorDetails>(DEMO_DETAILS_EVENT, { detail: d }));
  }

  const inputCls = "h-11 w-full rounded-xl border border-[var(--border-2)] bg-[var(--bg-elevated)] px-3.5 text-sm text-[var(--text-1)] outline-none placeholder:text-[var(--text-4)] focus:border-[#4d90f0] focus:ring-4 focus:ring-[#4d90f0]/15";

  return (
    <>
      <button type="button" onClick={show} className={className} style={style}><Phone size={16} /> Try it now</button>
      {open && (
        <div className="fixed inset-0 z-[100] flex items-end justify-center bg-black/60 p-0 backdrop-blur-sm sm:items-center sm:p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(false); }}>
          <div role="dialog" aria-modal="true" aria-labelledby="try-title" className="animate-slide-up w-full max-w-md rounded-t-3xl border border-[var(--border)] bg-[var(--bg-card)] p-5 shadow-2xl sm:rounded-3xl sm:p-6">
            <div className="flex items-start gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-white" style={{ background: `linear-gradient(145deg,${PRIMARY},#6b5cd6)` }}><Sparkles size={18} /></span>
              <div className="min-w-0 flex-1">
                <h2 id="try-title" className="text-lg font-semibold text-[var(--text-1)]">Take a call from an AI agent</h2>
                <p className="text-sm text-[var(--text-2)]">Tell us who you are and we&apos;ll pick the agents that fit your business. Then one of them calls you, right here in the browser.</p>
              </div>
              <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="rounded-lg p-1.5 text-[var(--text-3)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-1)]"><X size={18} /></button>
            </div>
            <form onSubmit={submit} className="mt-5 grid gap-3">
              <div>
                <label htmlFor="try-first" className="mb-1.5 block text-xs font-medium text-[var(--text-2)]">Your first name</label>
                <input id="try-first" required maxLength={40} autoFocus value={v.firstName} onChange={(e) => setV({ ...v, firstName: e.target.value })} placeholder="e.g. Chris" className={inputCls} />
              </div>
              <div>
                <label htmlFor="try-biz" className="mb-1.5 block text-xs font-medium text-[var(--text-2)]">Business name</label>
                <input id="try-biz" required maxLength={80} value={v.company} onChange={(e) => setV({ ...v, company: e.target.value })} placeholder="e.g. Riverside Dental" className={inputCls} />
              </div>
              <div>
                <label htmlFor="try-type" className="mb-1.5 block text-xs font-medium text-[var(--text-2)]">What does your business do?</label>
                <input id="try-type" required minLength={3} maxLength={200} value={v.businessType} onChange={(e) => setV({ ...v, businessType: e.target.value })} placeholder="e.g. dental clinic, online casino, gym, car dealership" className={inputCls} />
              </div>
              <button type="submit" className="mt-1 inline-flex h-12 items-center justify-center gap-2 rounded-xl text-sm font-semibold text-white transition hover:brightness-110" style={{ background: PRIMARY, boxShadow: `0 8px 24px ${PRIMARY}33` }}>
                <Sparkles size={16} /> Find my agents
              </button>
              <p className="text-[11px] text-[var(--text-4)]">No account needed. Demo calls last up to 4 minutes.</p>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
