"use client";

import type { ReactNode } from "react";

// Global Performance's hero (ported from the dashboard mockup, Jasiel 2026-09-02): ONE connect
// rate for the window and whether it is gaining or losing against the equal-length window
// before it. This replaced the three PerformanceCards that sat here: their Call attempts /
// Reached / SMS numbers duplicate Campaign Performance's own summary below, and Global's job
// is the one question those cards never answered.
//
// The rate is prod's connect rate (connected / completed calls), so it equals the KPI the
// route computes for the same window. The comparison drops outage days on BOTH sides first;
// the rate itself is never adjusted. All of that logic lives in lib/connectRateHero.ts and is
// unit-tested; this file only draws it.

import Hint from "@/components/Hint";
import type { TrendPoint } from "@/lib/dashboardAnalytics";
import {
  summarizeWindow, compareWindows, deltaLabel, barSeries, barGeometry, OUTAGE_MIN_COMPLETED, type DayCount,
} from "@/lib/connectRateHero";
import { ROW_COLOR, EstBadge } from "./PerformanceCards";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const shortDate = (iso: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]}` : iso;
};
const fmt = (n: number) => n.toLocaleString("en-US");

export function Info({ text }: { text: string }) {
  return (
    <Hint content={<span className="block max-w-[320px] text-[11px] leading-relaxed">{text}</span>}>
      <span
        tabIndex={0}
        role="note"
        aria-label={text}
        className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full border border-[var(--border-2)] text-[9px] text-[var(--text-3)] cursor-help select-none align-middle"
      >
        i
      </span>
    </Hint>
  );
}

export default function ConnectRateHero({
  trend,
  baseline,
  rangeDays,
  todayIso,
  estimated,
  noBaselineWhy,
  lead,
}: {
  trend: TrendPoint[];
  baseline: DayCount[] | null;
  rangeDays: number;
  /** Today's UTC date: the bar for it is drawn faded, it is still running. */
  todayIso: string;
  /** Long windows include connects not yet evaluated for voicemail (forward-only detection). */
  estimated: boolean;
  /** Why there is no baseline when the API sent none ON PURPOSE (all time, a number search).
   *  Without it a null baseline reads as "no completed calls in the prior window", which is
   *  a different claim and a wrong one. */
  noBaselineWhy?: string;
  /** The Audience mockup sits its stat tiles flush at the top of this card, divided by a hairline
   *  ("combine them", Jasiel). Rendered above everything else when given; the dashboard passes none. */
  lead?: ReactNode;
}) {
  const days: DayCount[] = trend.map((p) => ({ day: p.day, terminal: p.terminal, connected: p.connected }));
  const A = summarizeWindow(days);
  const B = baseline ? summarizeWindow(baseline) : null;
  const g = !B && noBaselineWhy ? { ok: false as const, why: noBaselineWhy } : compareWindows(A, B);
  const notConnected = A.terminal - A.connected;
  // One bar per day up to a month; weekly buckets past that; the 1970 zero-fill trimmed.
  const bars = barSeries(days);
  const weekly = bars.some((b) => b.days > 1);
  // Height by calls, green portion by rate; the arithmetic and its known-bad control live in the lib.
  const geo = barGeometry(bars);
  // the window as drawn: the first day with a completed call (lifetime zero-fills from 1970)
  const first = bars[0]?.label, last = days[days.length - 1]?.day;


  // The delta, fused into the headline column (Jasiel 2026-09-11: "fuse this to this"). It used
  // to be its own column between the number and the bars, which read as a third thing on the row;
  // it is a property OF the rate, so it sits under it.
  const delta = g.ok
    ? (() => {
        const d = deltaLabel(g.pts);
        const cls = d.dir === "up" ? "text-[#3ec08a]" : d.dir === "down" ? "text-[#e46664]" : "text-[var(--text-2)]";
        const byBase = g.dropped.filter((x) => x.side === "baseline").map((x) => shortDate(x.day));
        const byWin = g.dropped.filter((x) => x.side === "window").map((x) => shortDate(x.day));
        return (
          <div className="mt-2.5">
            <span className={`font-mono text-[13px] ${cls}`}>{d.text}</span>
            <div className="text-[11px] text-[var(--text-3)] flex items-center gap-1 flex-wrap">
              {/* The baseline's SIZE, always: at 90d the previous window is the pilot (1,140
                  completed calls against 76,541, measured 2026-09-02). The delta is arithmetically
                  honest; the reader still needs to see what it stands on. */}
              vs the previous {rangeDays} days ({fmt(B!.connected)} of {fmt(B!.terminal)} completed)
              {g.dropped.length > 0 && (
                <>
                  {" · "}{g.dropped.length} outage day{g.dropped.length === 1 ? "" : "s"} excluded
                  <Info text={
                    `A day that completed at least ${OUTAGE_MIN_COMPLETED} calls and connected nothing is an outage, not trading. Both sides of this comparison drop those days before their rates are taken, so the two figures describe the same kind of day. ` +
                    `Dropped: ${[byWin.length ? `${byWin.join(", ")} from this window` : "", byBase.length ? `${byBase.join(", ")} from the baseline` : ""].filter(Boolean).join("; ")}. ` +
                    `Only the denominator moves; such a day contributes no connects by definition. The rate above is NOT adjusted.`
                  } />
                </>
              )}
            </div>
          </div>
        );
      })()
    : <p className="mt-2.5 text-[11px] text-[var(--text-3)] leading-relaxed">▪ No comparable baseline. {g.why}</p>;

  return (
    // ONE row of columns divided by hairlines (Jasiel 2026-09-11, the mockup's layout, not its
    // type or colour): what the audience IS, how well it CONNECTS, and how that ran DAY BY DAY.
    // The three used to stack into two bands, and the delta sat as a fourth thing between the
    // number and the bars. The card pads nothing itself so the dividers reach its edges; each
    // column pads its own content.
    <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] overflow-hidden">
      {estimated && (
        <p className="text-[11px] text-[var(--text-3)] flex items-center gap-1.5 px-5 pt-4 -mb-1">
          <EstBadge tone="warn" content="Estimated: long windows include connects not yet evaluated for voicemail (forward-only from ~19 Jun), which count as reached." />
          Reached-based splits are best-effort over this window. Voicemail detection is forward-only from ~19 Jun.
        </p>
      )}
      <div className="flex flex-wrap items-stretch">
        {/* TWO columns, not three (Jasiel 2026-09-11: "can we just make it 1?"). The lane size is
            context for the rate, not a peer of it, so it rides one horizontal line above it
            instead of holding a column and a 22 px number of its own. */}
        <div className="px-5 py-4 border-b sm:border-b-0 sm:border-r border-[var(--border)] min-w-[270px] grow sm:grow-0">
          {lead && <div className="mb-2.5">{lead}</div>}
          <h3 className="text-[13px] font-semibold text-[var(--text-1)] flex items-center gap-1.5">
            Connect rate
            <Info text="Connected calls as a share of completed calls. Connected means the carrier put the call through and there was talk time, which includes answering machines. The same definition every other connect rate on this page uses." />
          </h3>
          <div className="font-mono text-[38px] font-medium leading-none tracking-[-0.03em] text-[var(--text-1)] mt-2.5">
            {A.rate == null ? "—" : `${A.rate.toFixed(1)}%`}
          </div>
          <div className="text-[11px] text-[var(--text-3)] mt-1.5">
            {fmt(A.connected)} of {fmt(A.terminal)} completed calls
          </div>
          {/* The rate above INCLUDES outage days: it reports what the window did. Say so where
              the number is read, not on a range bar somewhere else. */}
          {A.deadDays.length > 0 && (
            <div className="text-[11px] text-amber-400/90 mt-1 flex items-start gap-1">
              <span>
                ⚠ includes {A.deadDays.length} outage day{A.deadDays.length === 1 ? "" : "s"}: {A.deadDays.map(shortDate).join(", ")},{" "}
                {fmt(A.deadTerminal)} completed calls, zero connects
              </span>
              <Info text="Those calls are inside the figure above, because it reports what the window actually did. The comparison below it drops them, where mixing them in would turn an outage into a trend." />
            </div>
          )}
          {delta}
        </div>

        {/* Day by day, then the window's own split under it as the colour key. */}
        <div className="px-5 py-4 flex-1 min-w-[330px] flex flex-col">
          <div className="flex items-baseline justify-between gap-3 mb-1.5">
            <span className="text-[13px] font-semibold text-[var(--text-1)] flex items-center gap-1.5">
              {weekly ? "Calls by week" : "Calls by day"}
              <Info text="One bar per period. How TALL it is says how many calls completed; the green part inside says how many of them connected, amber the rest. Height used to be the connect rate, which drew near-identical bars because the rate moves in a narrow band while the volume does not." />
            </span>
            {first && last && (
              <span className="text-[11px] font-mono text-[var(--text-3)] whitespace-nowrap">
                {shortDate(first)} → {shortDate(last)} · {rangeDays}-day series
              </span>
            )}
          </div>

          {/* One bar per day (or per week past a month). HEIGHT is that period's completed calls
              against the busiest period; the GREEN portion inside it is that period's connect
              rate, amber above it what never connected. Height used to be the rate, which drew
              seven near-identical bars (Jasiel 2026-09-11: "what is these bars for?"): 87.7-91.9%
              against 86-457 calls over 4-10 Sep. A dead period keeps its hatch, one with no calls
              is a flat stub, the period holding today is faded. Labels only when they fit: every
              bar for two weeks or less, every 7th day up to a month, the first day when weekly. */}
          <div className="flex items-end gap-[3px] h-[92px]" aria-label={weekly ? "Calls and connect rate by week" : "Calls and connect rate by day"}>
            {bars.map((b, i) => {
              const { height, connectedShare } = geo[i];
              const rate = b.terminal ? connectedShare : null;
              const dead = b.terminal > 0 && b.connected === 0;
              const idle = b.terminal === 0;
              const when = weekly ? `week of ${shortDate(b.label)}` : shortDate(b.label);
              const title = idle
                ? `${when}: no completed calls`
                : dead
                  ? `${when}: ${fmt(b.terminal)} completed, ZERO connected`
                  : `${when}: ${fmt(b.connected)} of ${fmt(b.terminal)} connected (${rate!.toFixed(1)}%)`;
              const holdsToday = weekly ? i === bars.length - 1 && b.label <= todayIso : b.label === todayIso;
              const showLabel = bars.length <= 15 || weekly || i % 7 === 0;
              return (
                <span key={b.label} className="group relative flex-1 flex flex-col justify-end items-center gap-1 h-full min-w-0">
                  {/* The rate lives in a hover on the bar (Jasiel 2026-09-11: a row of fourteen
                      percentages over the bars read as clutter). Same tooltip as Deposits by day,
                      so the two charts behave alike; the day label under the bar stays printed. */}
                  <span className="pointer-events-none absolute bottom-[calc(100%+4px)] left-1/2 -translate-x-1/2 whitespace-nowrap rounded-md border border-[var(--border-2)] bg-[var(--bg-elevated)] px-2 py-1 font-mono text-[10.5px] text-[var(--text-2)] opacity-0 transition-opacity group-hover:opacity-100 z-10">
                    {title}{holdsToday ? " · today, still running" : ""}
                  </span>
                  {/* The bar gets its OWN track. A percentage height resolves against the parent,
                      so while the bar sat directly in the column it was measured against the
                      column's full height, which also holds these two label rows: the tallest bars
                      hit the ceiling and 260 calls drew the same as 457 (caught in the screenshot
                      2026-09-11, after every number-level check had already passed). flex-1 gives
                      the track a definite height of its own, so the percentages mean what they say. */}
                  <span className="w-full flex-1 min-h-0 flex items-end">
                    <span
                      className={`w-full rounded-t-[2px] flex flex-col justify-end overflow-hidden ${holdsToday ? "opacity-45" : ""}`}
                      style={
                        idle
                          ? { height: 2, background: "var(--bg-hover)" }
                          : dead
                            ? { height: `${height.toFixed(1)}%`, minHeight: 2, background: `repeating-linear-gradient(45deg, ${ROW_COLOR.unreachable} 0 2px, transparent 2px 4px)`, opacity: 0.7 }
                            : { height: `${height.toFixed(1)}%`, minHeight: 2, background: ROW_COLOR.unreachable }
                      }
                    >
                      {!idle && !dead && (
                        <span className="w-full" style={{ height: `${connectedShare.toFixed(1)}%`, background: ROW_COLOR.reached }} />
                      )}
                    </span>
                  </span>
                  <span className="font-mono text-[10px] text-[var(--text-3)] whitespace-nowrap h-[13px]">
                    {showLabel ? (weekly ? shortDate(b.label) : b.label.slice(8)) : ""}
                  </span>
                </span>
              );
            })}
          </div>

          {/* The whole window as one bar, directly under the days it is made of. It is also the
              colour key for those bars, which is why it earns its place here and did not when it
              sat at the foot of the card restating the headline. */}
          <div className="flex h-1.5 rounded-[3px] overflow-hidden mt-2.5" aria-label="Connected and not connected in this window">
            <span style={{ flex: A.connected || 0, background: ROW_COLOR.reached }} />
            <span style={{ flex: notConnected || 0, background: ROW_COLOR.unreachable }} />
          </div>
          <div className="flex items-center gap-3 mt-1.5 text-[11px] text-[var(--text-3)]">
            <span className="flex items-center gap-1.5">
              <span className="w-[7px] h-[7px] rounded-full" style={{ background: ROW_COLOR.reached }} />
              connected
              <Info text="The carrier put us through and there was talk time. Includes answering machines, so this is not the same as reaching a person." />
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-[7px] h-[7px] rounded-full" style={{ background: ROW_COLOR.unreachable }} />
              did not
              <Info text="The carrier never put us through: no talk time at all. Carrier refusals live here." />
            </span>
            <span className="ml-auto font-mono text-[var(--text-2)]">{fmt(A.connected)} / {fmt(notConnected)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
