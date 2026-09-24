"use client";

import { useCallback, useEffect, useLayoutEffect, useState } from "react";
import { ArrowLeft, ArrowRight, X } from "lucide-react";
import type { TourDef } from "@/lib/tours/tours";

// A spotlight walkthrough: dims the page, cuts a hole around the current step's element, and
// shows a card next to it. Steps without a visible target show centred. Esc skips.

const PAD = 8;
const CARD_W = 340;

interface Rect { top: number; left: number; width: number; height: number }

export default function Tour({ tour, onFinish, onSkip }: { tour: TourDef; onFinish: () => void; onSkip: () => void }) {
  const [i, setI] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  const step = tour.steps[i];
  const last = i === tour.steps.length - 1;

  const measure = useCallback(() => {
    if (!step.target) { setRect(null); return; }
    const el = document.querySelector<HTMLElement>(`[data-tour="${step.target}"]`);
    if (!el || el.offsetParent === null && getComputedStyle(el).position !== "fixed") { setRect(null); return; }
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) { setRect(null); return; }
    setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
  }, [step.target]);

  // Measuring the target's box IS the point of this layout effect (the spotlight must know where
  // the element is before paint), so the synchronous setState is intended.
  /* eslint-disable react-hooks/set-state-in-effect */
  useLayoutEffect(() => {
    const el = step.target ? document.querySelector<HTMLElement>(`[data-tour="${step.target}"]`) : null;
    el?.scrollIntoView({ block: "nearest", inline: "nearest" });
    measure();
  }, [measure, step.target]);
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onSkip(); if (e.key === "ArrowRight" && !last) setI((n) => n + 1); if (e.key === "ArrowLeft" && i > 0) setI((n) => n - 1); };
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("resize", measure); window.removeEventListener("scroll", measure, true); window.removeEventListener("keydown", onKey); };
  }, [measure, onSkip, last, i]);

  // Card position: prefer the requested side, fall back to whatever fits in the viewport.
  const vw = typeof window !== "undefined" ? window.innerWidth : 1280;
  const vh = typeof window !== "undefined" ? window.innerHeight : 800;
  const w = Math.min(CARD_W, vw - 32);
  let cardStyle: React.CSSProperties;
  if (!rect) {
    // Numeric centring: a transform here would be overridden by the slide-up animation's own.
    cardStyle = { left: Math.max(16, (vw - w) / 2), top: Math.max(16, vh / 2 - 120), width: w };
  } else {
    const below = rect.top + rect.height + PAD + 12;
    const above = rect.top - PAD - 12;
    const placement = step.placement ?? (below + 220 < vh ? "bottom" : "top");
    let top = 0, left = 0;
    if (placement === "right" && rect.left + rect.width + PAD + 12 + w < vw) { left = rect.left + rect.width + PAD + 12; top = rect.top; }
    else if (placement === "left" && rect.left - PAD - 12 - w > 0) { left = rect.left - PAD - 12 - w; top = rect.top; }
    else if (placement === "top" && above - 220 > 0) { top = above - 220; left = rect.left; }
    else { top = Math.min(below, vh - 240); left = rect.left; }
    left = Math.max(16, Math.min(left, vw - w - 16));
    top = Math.max(16, Math.min(top, vh - 240));
    cardStyle = { left, top, width: w };
  }

  return (
    <div className="fixed inset-0 z-[100]" role="dialog" aria-modal="true" aria-label={tour.name}>
      {/* Dim everything except the target: a huge box-shadow around the hole. */}
      {rect ? (
        <div aria-hidden className="pointer-events-none fixed rounded-xl transition-all duration-200" style={{ top: rect.top - PAD, left: rect.left - PAD, width: rect.width + PAD * 2, height: rect.height + PAD * 2, boxShadow: "0 0 0 9999px rgba(0,0,0,0.62), 0 0 0 2px #4d90f0" }} />
      ) : (
        <div aria-hidden className="fixed inset-0 bg-black/62" />
      )}
      <button type="button" aria-label="Skip tour" onClick={onSkip} className="absolute inset-0 cursor-default" />
      <div className="fixed rounded-2xl border border-[var(--border-2)] bg-[var(--bg-card)] p-5 shadow-2xl animate-slide-up" style={cardStyle}>
        <div className="flex items-start justify-between gap-3">
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--text-3)]">{tour.name} · {i + 1}/{tour.steps.length}</p>
          <button type="button" onClick={onSkip} aria-label="Skip tour" className="-mr-1 -mt-1 rounded-lg p-1 text-[var(--text-3)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-1)]"><X size={15} /></button>
        </div>
        <h3 className="mt-2 text-base font-semibold text-[var(--text-1)]">{step.title}</h3>
        <p className="mt-1.5 text-sm leading-relaxed text-[var(--text-2)]">{step.body}</p>
        <div className="mt-4 flex items-center gap-2">
          <div className="flex flex-1 items-center gap-1">
            {tour.steps.map((_, k) => <span key={k} className={`h-1.5 rounded-full transition-all ${k === i ? "w-4 bg-primary" : "w-1.5 bg-[var(--border-2)]"}`} />)}
          </div>
          {i > 0 && <button type="button" onClick={() => setI((n) => n - 1)} className="inline-flex h-9 items-center gap-1 rounded-lg border border-[var(--border)] px-3 text-xs font-medium text-[var(--text-2)] hover:text-[var(--text-1)]"><ArrowLeft size={13} /> Back</button>}
          {!last && <button type="button" onClick={onSkip} className="h-9 px-2 text-xs text-[var(--text-3)] hover:text-[var(--text-1)]">Skip</button>}
          <button type="button" onClick={() => (last ? onFinish() : setI((n) => n + 1))} className="inline-flex h-9 items-center gap-1 rounded-lg bg-primary px-3.5 text-xs font-semibold text-white hover:brightness-110">
            {last ? "Done" : "Next"} {!last && <ArrowRight size={13} />}
          </button>
        </div>
      </div>
    </div>
  );
}
