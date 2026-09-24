"use client";

import { useEffect, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { CircleHelp, Play, RotateCcw } from "lucide-react";
import Tour from "@/components/Tour";
import { TOURS, TOUR_ORDER, tourForPath, type TourId } from "@/lib/tours/tours";
import { useTours } from "@/lib/tours/useTours";

// Starts the right tour the first time a user lands on a page, and renders the floating ? button
// (bottom-right; above the phone tab bar) that lists every tour so any of them can be replayed.
// Mounted once in AppChrome, console pages only.

export default function TourLauncher() {
  const pathname = usePathname();
  const params = useSearchParams();
  const { done, loaded, mark, reset } = useTours();
  const [active, setActive] = useState<TourId | null>(null);
  const [menu, setMenu] = useState(false);

  // Auto-start: the welcome tour once (first login), then each page's tour on first visit.
  useEffect(() => {
    if (!loaded || active) return;
    const t = tourForPath(pathname);
    if (params.get("welcome") === "1" && !done?.welcome && pathname.startsWith("/dashboard")) { setTimeout(() => setActive("welcome"), 600); return; }
    if (!done?.welcome && pathname.startsWith("/dashboard")) { setTimeout(() => setActive("welcome"), 900); return; }
    if (t && !done?.[t.id] && done?.welcome) { setTimeout(() => setActive(t.id), 900); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, pathname, done?.welcome]);

  const here = tourForPath(pathname);

  return (
    <>
      {active && (
        <Tour tour={TOURS[active]} onFinish={() => { void mark(active, "done"); setActive(null); }} onSkip={() => { void mark(active, "skipped"); setActive(null); }} />
      )}
      {!active && (
        <div className="fixed bottom-[calc(4.25rem+env(safe-area-inset-bottom))] right-4 z-40 md:bottom-5 md:right-5">
          {menu && (
            <>
              <button type="button" aria-label="Close" onClick={() => setMenu(false)} className="fixed inset-0 cursor-default" />
              <div className="absolute bottom-12 right-0 w-64 rounded-2xl border border-[var(--border-2)] bg-[var(--bg-card)] p-2 shadow-2xl">
                <p className="px-2 py-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--text-3)]">Guided tours</p>
                {TOUR_ORDER.map((id) => {
                  const t = TOURS[id];
                  const state = done?.[id];
                  const onThisPage = here?.id === id;
                  return (
                    <button key={id} type="button" onClick={() => { setMenu(false); if (onThisPage || id === "welcome") { setActive(id); } else { window.location.assign(`${t.path}?tour=${id}`); } }}
                      className="flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left text-sm text-[var(--text-2)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-1)]">
                      {state ? <RotateCcw size={14} className="shrink-0 text-[var(--text-3)]" /> : <Play size={14} className="shrink-0 text-primary" />}
                      <span className="flex-1">{t.name}</span>
                      {state && <span className="text-[10px] uppercase text-[var(--text-4)]">{state}</span>}
                    </button>
                  );
                })}
                <button type="button" onClick={() => { void reset(); setMenu(false); }} className="mt-1 w-full rounded-lg px-2 py-1.5 text-left text-[11px] text-[var(--text-4)] hover:text-[var(--text-2)]">Reset all tours</button>
              </div>
            </>
          )}
          <button type="button" onClick={() => setMenu((m) => !m)} aria-label="Help and tours" title="Guided tours"
            className="flex h-10 w-10 items-center justify-center rounded-full border border-[var(--border-2)] bg-[var(--bg-card)] text-[var(--text-2)] shadow-lg transition hover:text-[var(--text-1)] hover:border-primary/50">
            <CircleHelp size={18} />
          </button>
        </div>
      )}
      <TourQueryStarter onStart={(id) => setActive(id)} />
    </>
  );
}

// ?tour=<id> on a page (from the menu's cross-page navigation) starts that tour once.
function TourQueryStarter({ onStart }: { onStart: (id: TourId) => void }) {
  const params = useSearchParams();
  const id = params.get("tour") as TourId | null;
  useEffect(() => {
    if (id && TOURS[id]) {
      const t = setTimeout(() => onStart(id), 700);
      return () => clearTimeout(t);
    }
  }, [id, onStart]);
  return null;
}
