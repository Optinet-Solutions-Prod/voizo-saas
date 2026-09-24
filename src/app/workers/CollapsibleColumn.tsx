// src/app/workers/CollapsibleColumn.tsx
//
// Side column that auto-collapses to a rail when the cursor leaves it
// (Supabase-pattern). A lock chip in the corner toggles between AUTO
// (hover-to-expand) and LOCKED (always expanded). Lock state persists per
// side in localStorage so the user's preference survives reload.
//
// Phones (below md): there is no hover and no room for side columns, so the
// column is either hidden (`mobile="hidden"`) or pinned open as a bottom sheet
// over the lower part of the globe (`mobile="sheet"`, the default).
//
// Usage:
//   <CollapsibleColumn side="left" storageKey="workers-clocks">
//     <WorldClocks now={now} />
//   </CollapsibleColumn>

"use client";

import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { Lock, LockOpen } from "lucide-react";

interface Props {
  side: "left" | "right";
  /** Rail label(s) shown when collapsed (one per visible child panel). */
  railLabels?: string[];
  /** LocalStorage key for the lock state. Omit to skip persistence. */
  storageKey?: string;
  /** Initial lock state if no persisted value. Default false (= AUTO). */
  defaultLocked?: boolean;
  /** Expanded width in px. Default 320. */
  width?: number;
  /** Below md: "sheet" pins the panel open across the bottom (default), "hidden" removes it. */
  mobile?: "sheet" | "hidden";
  children: ReactNode;
}

export default function CollapsibleColumn({
  side, railLabels = [], storageKey,
  defaultLocked = false, width = 320, mobile = "sheet", children,
}: Props) {
  // Lazy initializer reads localStorage on first mount (client-only via
  // "use client") — avoids the set-state-in-effect lint by initializing
  // straight to the persisted value instead of post-mount syncing.
  const [locked, setLocked] = useState<boolean>(() => {
    if (!storageKey) return defaultLocked;
    try {
      const v = localStorage.getItem(storageKey);
      if (v === "true") return true;
      if (v === "false") return false;
    } catch { /* ignore — fall through to default */ }
    return defaultLocked;
  });
  const [hovered, setHovered] = useState(false);

  // Persist lock state on change.
  useEffect(() => {
    if (!storageKey) return;
    try { localStorage.setItem(storageKey, String(locked)); } catch { /* ignore */ }
  }, [locked, storageKey]);

  const collapsed = !locked && !hovered;

  const sideClass = side === "left" ? "left-0" : "right-0";
  const lockAlign = side === "left" ? "self-start" : "self-end";
  const mobileClass = mobile === "hidden" ? "hidden md:flex" : "max-md:inset-x-0 max-md:top-auto max-md:bottom-0 max-md:h-[44%] max-md:w-auto max-md:px-2 max-md:pb-2";

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className={`absolute md:top-4 md:bottom-12 ${sideClass} z-10 flex flex-col gap-2.5 px-3 md:w-[var(--col-w)] transition-[width] duration-300 ease-[cubic-bezier(.2,.7,.2,1)] ${mobileClass}`}
      style={{ "--col-w": `${collapsed ? 42 : width}px` } as CSSProperties}>

      {/* Lock chip (desktop only — the phone sheet is always open) */}
      <button
        onClick={() => setLocked(l => !l)}
        title={locked ? "Unlock (auto-collapse on mouse-leave)" : "Lock open"}
        aria-pressed={locked}
        className={`hidden md:grid ${lockAlign} w-6 h-6 rounded-lg place-items-center transition-all border ${
          locked
            ? "bg-[var(--bg-card)] border-[var(--border-2)] text-[var(--text-1)]"
            : "bg-[var(--bg-card)] border-[var(--border)] text-[var(--text-3)] hover:text-[var(--text-1)] hover:border-[var(--border-2)]"
        }`}>
        {locked ? <Lock size={11} /> : <LockOpen size={11} />}
      </button>

      {/* Rail (collapsed) — vertical labels */}
      <div className={`hidden md:flex flex-1 flex-col items-center gap-3 pt-1 transition-opacity ${collapsed ? "opacity-100" : "opacity-0 pointer-events-none"}`}>
        {railLabels.map((label, i) => (
          <div
            key={i}
            className="text-[9px] tracking-[0.22em] uppercase text-[var(--text-3)] font-mono pt-2 border-l border-[var(--border)] pl-1"
            style={{ writingMode: "vertical-rl", transform: "rotate(180deg)" }}>
            {label}
          </div>
        ))}
      </div>

      {/* Panel children (expanded on desktop; the whole sheet on phones) */}
      <div className={`md:absolute md:top-12 ${sideClass === "left-0" ? "md:left-3" : "md:right-3"} md:bottom-0 md:w-[var(--panel-w)] max-md:h-full max-md:min-h-0 transition-opacity ${collapsed ? "md:opacity-0 md:pointer-events-none" : "opacity-100 delay-100"}`}
           style={{ "--panel-w": `${width - 24}px` } as CSSProperties}>
        <div className="h-full flex flex-col gap-2.5 overflow-hidden">
          {children}
        </div>
      </div>
    </div>
  );
}
