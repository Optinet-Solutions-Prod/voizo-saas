"use client";

// Player activity (Audience mockup 2026-08-25, `members()` + `openDrawer()`), slice 4 of the wire.
// Built to the mockup's shape on purpose after the first cut drifted from it (Jasiel 2026-09-04):
//   - columns Phone · Market (All markets only) · Campaign (the FAMILY, "also in …") ·
//     Last 3 calls → · Last contact. No name column: the name lives in the drawer's header.
//   - the last three calls are 8px SQUARES, colours from ROW_COLOR (the app's single source).
//   - "Last contact" reads MM-DD HH:mm in mono, as the mockup's `when`.
//   - the panel head carries the count at the right and the legend sits in the foot.
//   - a row opens the mockup's RIGHT-SIDE DRAWER (392px, scrim), not the dashboard's modal:
//     phone + sub line, a three-stat grid, a vertical timeline (calls, texts, first-contact
//     pin), a legend and a note. Escape, the scrim and the ✕ close it.
// Pages of 25 (Jasiel 2026-09-03: pages, never "show all"). The search lives in the page's top
// row, as the mockup's `#q`, and arrives here as `query`.
//
// Not here yet, on purpose: "Deposited after contact" (column, toggle, stat, timeline events)
// waits on the deposit-history decision. A column of "—" would read as "nobody deposited".
import { useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import Pagination from "@/components/Pagination";
import { ROW_COLOR } from "../analytics/PerformanceCards";
import type { AudiencePlayerRow, Dot, PlayerEvent } from "../api/audience/players/route";

const PAGE = 25;
// The mockup's DOT_LABEL, split at its dash: the first clause is the legend word.
const DOT_LABEL: Record<Dot, [string, string]> = {
  spoke: ["spoke", "a human made a substantive turn"],
  silent: ["answered, no conversation", "silent pickup or early hang-up"],
  voicemail: ["voicemail", "the machine answered"],
  never: ["never connected", "the carrier never put us through"],
};
// The mockup's --o-* vars are copies of the app's ROW_COLOR; use the source.
const DOT_COLOR: Record<Dot, string> = {
  spoke: ROW_COLOR.reached,
  silent: ROW_COLOR.silent_pickup,
  voicemail: ROW_COLOR.voicemail,
  never: ROW_COLOR.unreachable,
};
const EVENT_COLOR = { call: ROW_COLOR.reached, sms: ROW_COLOR.neutral, dep: "var(--primary)", crm: "var(--text-3)" } as const;

// The mockup's mmddhm / mmdd, UTC.
const p2 = (n: number) => String(n).padStart(2, "0");
const mmddhm = (iso: string | null) => {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : `${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())} ${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}`;
};
const eventLine = (e: PlayerEvent) =>
  e.kind === "sms"
    ? `SMS ${e.what === "delivered" ? "delivered" : e.what} — offer follow-up`
    : `${e.what.replace(/_/g, " ")}${e.durationSeconds ? ` — ${e.durationSeconds}s` : ""}`;

export default function AudiencePlayers({ rows, loading, showMarket, query, brandLabel }: {
  rows: AudiencePlayerRow[];
  loading: boolean;
  /** All markets: each row names its market, because the phone alone does not. */
  showMarket: boolean;
  /** The page's search box (the mockup's `#q`): phone or name. */
  query: string;
  /** The brand in view, for the drawer's sub line; empty under All brands. */
  brandLabel: string;
}) {
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<AudiencePlayerRow | null>(null);

  const list = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((r) => (r.phone + " " + (r.name ?? "")).toLowerCase().includes(needle));
  }, [rows, query]);
  // A new scope or a new search starts at page one. Compared during render (the prevBrand
  // pattern DashboardView uses), not in an effect: react-hooks forbids a bare setState there.
  const [prevKey, setPrevKey] = useState<[AudiencePlayerRow[], string]>([rows, query]);
  if (prevKey[0] !== rows || prevKey[1] !== query) {
    setPrevKey([rows, query]);
    setPage(1);
  }
  const pages = Math.max(1, Math.ceil(list.length / PAGE));
  const cur = Math.min(page, pages);
  const shown = list.slice((cur - 1) * PAGE, cur * PAGE);

  // Escape closes the drawer, as the mockup's key handler does.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const cols = showMarket ? 5 : 4;
  return (
    <>
      <section className="bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl overflow-hidden" aria-label="Player activity">
        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-[var(--border)]">
          <h2 className="text-[12.5px] font-medium text-[var(--text-2)]">Player activity</h2>
          <span className="text-[11px] text-[var(--text-4)]">most recently contacted, across all campaigns</span>
          <span className="ml-auto font-mono text-[11px] text-[var(--text-4)]" aria-label="Players shown">{loading && rows.length === 0 ? "" : list.length}</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-[12.5px] border-collapse">
            <thead>
              <tr className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-3)]">
                <th className="text-left px-4 py-2 font-semibold">Phone</th>
                {showMarket && <th className="text-left px-3 py-2 font-semibold">Market</th>}
                <th className="text-left px-3 py-2 font-semibold">Campaign</th>
                <th className="text-left px-3 py-2 font-semibold">Last 3 calls →</th>
                <th className="text-right px-4 py-2 font-semibold">Last contact</th>
              </tr>
            </thead>
            <tbody>
              {loading && rows.length === 0 ? (
                <tr><td colSpan={cols} className="px-4 py-8 text-center text-xs text-[var(--text-3)] border-t border-[var(--border)]">Loading…</td></tr>
              ) : shown.length === 0 ? (
                <tr>
                  <td colSpan={cols} className="px-4 py-8 text-center text-xs text-[var(--text-3)] border-t border-[var(--border)]">
                    {query.trim() ? `No member matches “${query.trim()}”. An empty result is an answer.` : "No player has been contacted in this scope."}
                  </td>
                </tr>
              ) : (
                shown.map((r) => (
                  <tr
                    key={r.phone}
                    onClick={() => setOpen(r)}
                    className="border-t border-[var(--border)] hover:bg-[var(--bg-hover)] cursor-pointer transition-colors"
                  >
                    <td className="px-4 py-2 font-mono text-[var(--text-1)] whitespace-nowrap">{r.phone}</td>
                    {showMarket && <td className="px-3 py-2 font-mono text-[11px] text-[var(--text-3)]">{r.market || "—"}</td>}
                    <td className="px-3 py-2 text-[var(--text-2)]">
                      {r.campaignLabel}
                      {r.alsoIn.length > 0 && <> · <span className="text-primary">also in {r.alsoIn.join(", ")}</span></>}
                    </td>
                    <td className="px-3 py-2">
                      <span className="inline-flex gap-[3px]" aria-label={r.dots.map((d) => DOT_LABEL[d][0]).join(", ") || "no calls"}>
                        {r.dots.length === 0 ? (
                          <span className="text-[var(--text-4)]">—</span>
                        ) : (
                          r.dots.map((d, i) => (
                            <span key={i} title={`${DOT_LABEL[d][0]} — ${DOT_LABEL[d][1]}`} className="inline-block w-2 h-2 rounded-[2px]" style={{ background: DOT_COLOR[d] }} />
                          ))
                        )}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-right font-mono text-[11px] text-[var(--text-4)] whitespace-nowrap">{mmddhm(r.lastAt)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="flex items-center gap-[13px] flex-wrap px-4 py-2 border-t border-[var(--border)] text-[11px] text-[var(--text-4)]">
          {(Object.keys(DOT_LABEL) as Dot[]).map((d) => (
            <span key={d} className="inline-flex items-center gap-[5px]">
              <i className="inline-block w-2 h-2 rounded-[2px]" style={{ background: DOT_COLOR[d] }} />
              {DOT_LABEL[d][0]}
            </span>
          ))}
          <span className="ml-auto">
            <Pagination currentPage={cur} totalPages={pages} totalItems={list.length} pageSize={PAGE} onPageChange={setPage} noun="players" />
          </span>
        </div>
      </section>

      {/* The mockup's drawer: fixed right, 392px, over a scrim. */}
      {open && (
        <>
          <button type="button" aria-label="Close" onClick={() => setOpen(null)} className="fixed inset-0 z-[90] bg-black/50 cursor-default" />
          <aside
            role="dialog"
            aria-label="Member detail"
            className="fixed top-0 right-0 bottom-0 z-[95] w-[392px] max-w-[92vw] bg-[var(--bg-card)] border-l border-[var(--border)] shadow-2xl flex flex-col"
          >
            <div className="flex items-start gap-2.5 px-[17px] py-[15px] border-b border-[var(--border)]">
              <div className="min-w-0">
                <div className="font-mono text-[14px] text-[var(--text-1)]">{open.phone}</div>
                <div className="text-[11px] text-[var(--text-4)] mt-[3px] truncate">
                  {[brandLabel, open.campaignLabel, open.alsoIn.length ? `also in ${open.alsoIn.join(", ")}` : "", open.name ?? ""].filter(Boolean).join(" · ")}
                </div>
              </div>
              <button type="button" aria-label="Close" onClick={() => setOpen(null)} className="ml-auto text-[var(--text-3)] hover:text-[var(--text-1)]">
                <X size={15} />
              </button>
            </div>
            <div className="px-[17px] py-[15px] overflow-y-auto">
              <div className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-[7px] mb-4 text-[11.5px]">
                <div className="text-[var(--text-3)]">Calls</div><div className="font-mono text-[12px] text-right text-[var(--text-1)]">{open.calls}</div>
                <div className="text-[var(--text-3)]">SMS</div>
                <div className="font-mono text-[12px] text-right text-[var(--text-1)]">
                  {open.smsDelivered ? `${open.smsDelivered} delivered` : open.smsSent ? "sent, not confirmed" : "none"}
                </div>
                <div className="text-[var(--text-3)]">Deposits</div><div className="font-mono text-[12px] text-right text-[var(--text-4)]">not measured here</div>
              </div>
              <div className="border-l border-[var(--border)] pl-4 ml-1 flex flex-col gap-3">
                {[...open.events, ...(open.firstAt ? [{ at: open.firstAt, kind: "pin" as const }] : [])]
                  .sort((a, b) => (a.at < b.at ? 1 : -1))
                  .slice(0, 12)
                  .map((e, i) => (
                    <div key={i} className="relative">
                      <span
                        className="absolute -left-5 top-1 w-[7px] h-[7px] rounded-full"
                        style={{ background: e.kind === "pin" ? "var(--bg-card)" : EVENT_COLOR[e.kind], border: `1px solid ${e.kind === "pin" ? "var(--text-3)" : EVENT_COLOR[e.kind]}` }}
                      />
                      <div className="font-mono text-[10.5px] text-[var(--text-4)]">{mmddhm(e.at)}</div>
                      <div className="text-[12px] text-[var(--text-2)] mt-0.5">
                        {e.kind === "pin" ? <b className="font-medium text-[var(--text-1)]">First contact</b> : eventLine(e)}
                      </div>
                    </div>
                  ))}
              </div>
              <div className="flex gap-3 flex-wrap mt-3.5 text-[10.5px] text-[var(--text-4)]">
                <span className="inline-flex items-center gap-[5px]"><i className="inline-block w-[7px] h-[7px] rounded-full" style={{ background: EVENT_COLOR.call }} />Call</span>
                <span className="inline-flex items-center gap-[5px]"><i className="inline-block w-[7px] h-[7px] rounded-full" style={{ background: EVENT_COLOR.sms }} />Text</span>
                <span className="inline-flex items-center gap-[5px]"><i className="inline-block w-[7px] h-[7px] rounded-full border border-[var(--text-3)]" />First contact</span>
              </div>
              <p className="mt-[15px] text-[11px] text-[var(--text-4)] leading-relaxed">
                Deposits and CRM emails are not shown yet. This player&apos;s calls and texts are live from our own records.
              </p>
            </div>
          </aside>
        </>
      )}
    </>
  );
}
