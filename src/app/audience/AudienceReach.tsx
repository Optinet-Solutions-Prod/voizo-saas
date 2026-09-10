"use client";

// The Audience tab's aggregate cards, ported from the 2026-08-25 v4 mockup, functions read whole:
//   MembersStat    `stats()`, first tile only. The two lift tiles (the frozen 25 Aug study) stay off
//                  until live deposits cover a real window (Jasiel 2026-09-07).
//   ReachCard      `channels()`: independent bars on ONE denominator, NOT a funnel. Measured
//                  2026-09-01, 76-86% of texted players were never in a conversation, so nested or
//                  tapering bars would state something false about our own operation. Under Texted,
//                  the texts themselves by delivery receipt, in TEXTS; players above, texts below,
//                  the two units never share a bar. Since 2026-09-11 it follows the WINDOW and the
//                  Depositors table's filters, and it absorbed Contact this window; see its own
//                  block below for why three cards became one.
//   DepositsByDay  `whenMoney()` (VOZ-481): one bar per calendar day on the range control's window,
//                  weekly bars past 92 days. Bars are DEPOSITS; the tooltip says how many players
//                  made them, in words. A day outside what the table holds reads "not captured",
//                  never "no deposits". A money strip at the top (2026-09-07): deposits, depositors,
//                  gross per currency never summed across currencies, the CRM's EUR-normalised total.
//
// The word "Reached" is retired from the Reach card (2026-09-11). It named the dashboard's lean
// rule here and a stricter rule two cards down, on one page. The card now shows both rules and
// names each: "Answered" for the lean one, "Spoke with them" for the transcript rule.
import { Download } from "lucide-react";
import { Info } from "../analytics/ConnectRateHero";
import { ROW_COLOR } from "../analytics/PerformanceCards";
import { CSV_BOM, csvCell, triggerDownload } from "@/lib/download";
import type { AudienceDeposits, LaneReach } from "../api/audience/reach/route";
import type { LaneReachWindow } from "@/lib/audienceDeposits";

const fmt = (n: number | null | undefined) => (n == null ? "—" : n.toLocaleString("en-US"));
/** A loading placeholder the exact size of what it stands in for: the card keeps its height and the
 *  operator sees where the number will land (Jasiel 2026-09-07: "an operator expects something to
 *  look into even if the data still loads"). */
export const Pulse = ({ w, h = "h-3", className = "" }: { w: string; h?: string; className?: string }) => (
  <span aria-hidden className={`inline-block rounded bg-[var(--bg-elevated)] animate-pulse ${w} ${h} ${className}`} />
);
const money0 =(cur: string, n: number) => `${cur} ${Math.round(n).toLocaleString("en-US")}`;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const mmdd = (iso: string) => iso.slice(5, 10);
const shortDate = (iso: string) => `${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1]}`;

export function MembersStat({ reach, families, lanes, unavailable }: {
  reach: LaneReach | null;
  families: number;
  /** Market lanes combined under All markets; 0 or 1 says nothing. */
  lanes: number;
  unavailable?: string;
}) {
  const sub = reach
    ? `${fmt(families)} campaign ${families === 1 ? "family" : "families"}${lanes > 1 ? ` across ${lanes} market lanes` : ""}`
    : unavailable
      ? "not available yet"
      : "";
  return (
    <div className="px-5 py-3.5" aria-label="Members">
      <div className="flex items-center gap-[5px] text-[10px] uppercase tracking-[.07em] text-[var(--text-4)] mb-1.5">
        Members
        <Info text="Everyone loaded into these campaigns. Counted once per phone, even if they appear in several." />
      </div>
      <div className="font-mono text-[22px] font-medium leading-[1.1] tracking-[-0.02em] text-[var(--text-1)]">{reach ? fmt(reach.members) : unavailable ? "—" : <Pulse w="w-24" h="h-5" />}</div>
      <div className="mt-1 text-[11px] text-[var(--text-3)] min-h-[15px]">{sub}</div>
    </div>
  );
}

const TRACK = "grid grid-cols-[132px_1fr_62px_74px] items-center gap-[11px] max-[820px]:grid-cols-[104px_1fr_54px_62px] max-[820px]:gap-[7px]";
// A one-line caption under a row, in the LABEL column, so it reads as a note on the row above and
// never as another bar (Jasiel 2026-09-08: the full-width texts bar under Texted was the widest
// thing on the card, in a different unit, and its yellow meant something else one row up).
const NOTE = "font-mono text-[10.5px] text-[var(--text-4)] leading-snug -mt-[3px] mb-[7px]";

// Seven rows now instead of five, so the row is a little tighter than the mockup's 30 px; the card
// still stands where two cards stood before.
function Row({ label, n, members, color, note, ariaLabel }: { label: string; n: number; members: number; color: string; note: string; ariaLabel?: string }) {
  const p = members ? (100 * n) / members : 0;
  return (
    <div className={`${TRACK} py-[3.5px] text-[12px]`} role="row" aria-label={ariaLabel ?? label}>
      <span className="text-[var(--text-2)] flex items-center gap-[5px]">
        {label} <Info text={note} />
      </span>
      <span className="h-[7px] rounded-[4px] bg-[var(--bg-elevated)] overflow-hidden">
        <span className="block h-full rounded-[4px]" style={{ width: `${Math.max(p, n ? 0.6 : 0).toFixed(2)}%`, background: color }} />
      </span>
      <span className="font-mono text-[13px] text-right text-[var(--text-1)]">{p.toFixed(1)}%</span>
      <span className="font-mono text-[11.5px] text-right text-[var(--text-3)]">{fmt(n)}</span>
    </div>
  );
}

// ── The merged Reach card (Jasiel 2026-09-10, built 2026-09-11) ──
//
// One card, one window, one population. Until today the tab carried THREE cards with three windows
// and three different meanings of the word "reached": Reach (all time, lean), Contact this window
// (the window, a completed call of 30 seconds or more) and the Depositors filter (the window,
// strict). Jasiel, reading the money strip — which has followed the window and the table's filters
// since b188855 — above a filter-blind Reach card: "if we're looking at 7d it should be accurate to
// tell the players we reached, dialled, texted, emailed, deposited. maybe the other card that
// complements these is now redundant?" It was. Contact this window is gone; its SQL function stays
// in the database, unused, until a cleanup paste.
//
// The denominator is the players CONTACTED INSIDE THE WINDOW, matching the table's filters, and it
// is deliberately the union of the Dialled and Texted rows, so no bar can ever be wider than the
// card it sits in. "All" gives back the all-time view the old card showed.
//
// TWO REACH RULES, NAMED, SIDE BY SIDE. "Answered" is the dashboard's lean rule (connected, not
// voicemail — a pickup with nobody talking still counts). "Spoke with them" is the strict
// voizo_spoke_with() the Depositors filter uses. The word "Reached" is retired from this card on
// purpose: it is the loaded word, it meant two different things on the same page, and a reader is
// better served by both numbers and the gap between them. Measured 7d on 10 Sep: 285 answered,
// 31 spoke.
//
// The card's `spoke` and the table's "Spoke with them" total are NOT the same number and must not
// be expected to match: the card counts players spoken to INSIDE the window, the table counts
// players spoken to EVER whose last touch falls in the window (31 and 35 on 10 Sep). The card's set
// is a strict subset of the table's, which scripts/_gate-0911-reach-window.cjs proves player by
// player rather than asserting an equality that is not true.
//
// STILL NOT A FUNNEL. The bars share one denominator and overlap; most texted players were never
// spoken to. The texts sub-line counts TEXTS, never people, and never gets a bar of its own
// (2026-09-08: a full-width texts bar under Texted was the widest thing on the card, in a different
// unit, and its colour meant something else one row up).
//
// "Deposited after" and the money strip above it are two legitimate and different questions, so
// both name their rule: the strip is money DATED in the window after any earlier contact (an August
// player depositing this week counts); this row is players touched THIS week who deposited after
// that touch. Order, not cause — a holdout answers cause.
const REACH_ROWS: {
  key: "dialled" | "answered" | "spoke" | "texted" | "textDelivered" | "emailed" | "depositors";
  label: string;
  color: string;
  note: string;
}[] = [
  { key: "dialled", label: "Dialled", color: ROW_COLOR.unreachable,
    note: "At least one call attempt inside this window. Whether it connected is the next row." },
  { key: "answered", label: "Answered", color: ROW_COLOR.reached,
    note: "The call connected and was not voicemail. A pickup with nobody talking still counts here, which is why the row below is smaller. The same rule the connect rate above uses." },
  { key: "spoke", label: "Spoke with them", color: ROW_COLOR.positive,
    note: "Somebody talked back: the call connected, was not voicemail, and the transcript holds at least one thing the player said, or they turned the offer down outright. The same rule as the Spoke with them filter on the table below, applied to calls inside this window." },
  { key: "texted", label: "Texted", color: ROW_COLOR.neutral,
    note: "At least one text sent inside this window. Not a subset of Answered: most texted players were never spoken to. The line below counts texts, not people; unconfirmed means no delivery receipt came back." },
  { key: "textDelivered", label: "Text delivered", color: ROW_COLOR.voicemail,
    note: "The handset confirmed at least one text inside this window." },
  { key: "emailed", label: "Email follow-up sent", color: ROW_COLOR.agent_timeout,
    note: "The follow-up trigger reached Customer.io for this player inside this window. Whether the email then went out, landed and was opened is the CRM's record, and it is in the player's drawer." },
  { key: "depositors", label: "Deposited after", color: "var(--color-primary)",
    note: "Players touched inside this window who deposited at or after that touch. A narrower question than the money strip above, which counts every deposit dated in the window however long ago the player was first contacted. Order, not cause: there is no comparison group here, and only a holdout would show whether contact changed anything." },
];

/** "3 Sep → 10 Sep", or "all time" for the lifetime range, whose start is the epoch. */
function windowWords(from?: string | null, to?: string | null) {
  if (!from || !to) return "";
  return from < "2000" ? "all time" : `${shortDate(from)} → ${shortDate(to)}`;
}

export function ReachCard({ reach, from, to, unavailable, filterWords }: {
  reach: LaneReachWindow | null;
  from?: string | null;
  to?: string | null;
  unavailable?: string;
  /** The table's active filters in words, so the header says who is being counted. */
  filterWords?: string;
}) {
  const m = reach;
  const base = m?.contacted ?? 0;
  const tp = (n: number) => (m && m.msgs ? `${((100 * n) / m.msgs).toFixed(1)}%` : "—");
  const notAnswered = m && m.texted ? Math.round((100 * m.textedNotAnswered) / m.texted) : null;
  const when = windowWords(from, to);
  const who = filterWords ? ` · ${filterWords}` : "";
  return (
    <section className="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl px-[18px] py-4" aria-label="Reach">
      <div className="flex items-baseline gap-2.5 mb-1">
        <h2 className="text-[12.5px] font-medium text-[var(--text-2)] flex items-center gap-[5px]">
          Reach
          <Info text="How far each channel got with the players called or texted inside this window. Bars count people, not attempts, and they overlap: one player can be in several. It follows the window and the filters on the table below." />
        </h2>
        <span className="ml-auto font-mono text-[10.5px] text-[var(--text-4)] text-right">
          {m ? `${fmt(base)} players contacted${when ? ` · ${when}` : ""}${who}` : ""}
        </span>
      </div>
      {!m && unavailable ? (
        <p className="text-[11.5px] text-[var(--text-4)] py-3">Not available yet.</p>
      ) : !m ? (
        <div aria-label="Loading reach" aria-busy="true">
          {REACH_ROWS.map((r) => (
            <div key={r.key} className={`${TRACK} py-[3.5px] text-[12px]`}>
              <span className="text-[var(--text-3)]">{r.label}</span>
              <span className="h-[7px] rounded-[4px] bg-[var(--bg-elevated)] overflow-hidden animate-pulse" />
              <span className="text-right"><Pulse w="w-9" /></span>
              <span className="text-right"><Pulse w="w-12" /></span>
            </div>
          ))}
        </div>
      ) : base === 0 ? (
        <p className="text-[11.5px] text-[var(--text-4)] py-3">Nobody was called or texted in this window.</p>
      ) : (
        <>
          {REACH_ROWS.map((r) => (
            <div key={r.key}>
              <Row label={r.label} n={m[r.key]} members={base} color={r.color} note={r.note}
                ariaLabel={r.key === "depositors" ? "Deposited after contact" : undefined} />
              {r.key === "texted" && m.msgs > 0 && (
                <p className={NOTE}>{fmt(m.msgs)} texts · {tp(m.msgsDelivered)} delivered · {tp(m.msgsFailed)} failed · {tp(m.msgsUnconfirmed)} unconfirmed</p>
              )}
              {r.key === "depositors" && (
                <p className={NOTE} aria-label="Gross deposited after contact">
                  {m.deposits
                    ? `${fmt(m.deposits)} deposits · ${money0("EUR", m.amountEur)} · after a touch in this window`
                    : "no deposit after a touch in this window"}
                </p>
              )}
            </div>
          ))}
          {/* The footer's job is to stop a reader treating seven overlapping bars as a funnel. At
              0% the old wording ("0% of texted players were never answered") reads like a broken
              number rather than the fact it is, so the zero case says it in words instead. */}
          <p className="mt-[9px] pt-2.5 border-t border-[var(--border)] text-[11.5px] text-[var(--text-3)] leading-normal">
            {notAnswered == null
              ? "Not a funnel: the bars overlap and one player can be in several."
              : notAnswered === 0
                ? "Not a funnel: the bars overlap. In this window every texted player was answered too."
                : `Not a funnel: ${notAnswered}% of texted players were never answered.`}
          </p>
        </>
      )}
    </section>
  );
}

/** The window's UTC calendar dates, oldest first, from `fromIso`'s date to `toIso`'s date inclusive. */
function axisDays(fromIso: string, toIso: string): string[] {
  const day = (iso: string) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
  const start = day(fromIso), end = day(toIso);
  const out: string[] = [];
  for (let t = start; t <= end; t += 86_400_000) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}
/** Weekly buckets (Sunday-first, like the rest of the tab) for windows past 92 days. */
const weekOf = (iso: string) => { const d = new Date(iso + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() - d.getUTCDay()); return d.toISOString().slice(0, 10); };
const MAX_DAY_BARS = 92;

/** `filterWords` names the Depositors table's active filters (Jasiel 2026-09-10: the strip follows
 *  them), e.g. "Spoke with them · Fortune Play · RND REG YESTERDAY". Empty when nothing is filtered, and
 *  then the strip is the whole window for every contacted player, exactly as before. */
export function DepositsByDay({ deposits, unavailable, filterWords }: { deposits: AudienceDeposits | null; unavailable?: string; filterWords?: string }) {
  const d = deposits;
  const who = filterWords ? ` · ${filterWords}` : "";
  // A lifetime window starts at the epoch; the axis starts where the data can: the first captured deposit.
  const firstKnown = d?.coverage.captureFrom ?? d?.coverage.liveFrom ?? d?.days[0]?.day ?? null;
  const fromIso = d ? (d.from < "2000" && firstKnown ? firstKnown : d.from) : "";
  const days = d ? axisDays(fromIso, d.to) : [];
  const weekly = days.length > MAX_DAY_BARS;
  const byDay = new Map((d?.days ?? []).map((x) => [x.day, x]));
  const cov = d?.coverage;
  const covered = (day: string) =>
    (!!cov?.captureFrom && !!cov.captureTo && day >= cov.captureFrom.slice(0, 10) && day <= cov.captureTo.slice(0, 10)) ||
    (!!cov?.liveFrom && day >= cov.liveFrom.slice(0, 10));
  // Buckets: one per day, or one per Sunday-first week when the window is long.
  const buckets: { key: string; label: string; days: string[] }[] = [];
  if (weekly) {
    const m = new Map<string, string[]>();
    for (const day of days) { const w = weekOf(day); const g = m.get(w); if (g) g.push(day); else m.set(w, [day]); }
    for (const [w, ds] of m) buckets.push({ key: w, label: mmdd(w), days: ds });
  } else for (const day of days) buckets.push({ key: day, label: day.slice(8), days: [day] });
  const sum = (b: { days: string[] }, f: (x: { deposits: number; players: number }) => number) => b.days.reduce((a, day) => { const x = byDay.get(day); return a + (x ? f(x) : 0); }, 0);
  const total = days.reduce((a, day) => a + (byDay.get(day)?.deposits ?? 0), 0);
  const peak = Math.max(1, ...buckets.map((b) => sum(b, (x) => x.deposits)));
  const today = d ? d.to.slice(0, 10) : "";
  const totals = d?.totals ?? [];
  const depCount = totals.reduce((a, t) => a + t.deposits, 0);
  const eur = totals.reduce((a, t) => a + t.amountEur, 0);
  const before = totals.reduce((a, t) => a + t.before, 0);
  const coverageWords = cov
    ? [
        cov.captureFrom && cov.captureTo ? `${shortDate(cov.captureFrom)} to ${shortDate(cov.captureTo)}` : "",
        cov.liveFrom ? `${shortDate(cov.liveFrom)} onwards` : "",
      ].filter(Boolean).join(", ")
    : "";
  // `value` may be several lines (one per currency): money is never summed across currencies, and a
  // truncated third currency (seen 2026-09-07: "NZ…") would read as a rounding of the first two.
  const stat = (label: string, value: string | string[], sub?: string, note?: string) => (
    <div className="px-4 py-3 border-l border-[var(--border)] first:border-l-0 min-w-0" aria-label={label}>
      <div className="flex items-center gap-[5px] text-[10px] uppercase tracking-[.07em] text-[var(--text-4)] mb-1">{label}{note && <Info text={note} />}</div>
      {Array.isArray(value) ? (
        <div className="font-mono font-medium tracking-[-0.02em] text-[var(--text-1)] leading-[1.15]">
          {value.map((v, i) => <div key={v} className={i === 0 ? "text-[18px]" : "text-[14px] text-[var(--text-2)]"}>{v}</div>)}
        </div>
      ) : (
        <div className="font-mono text-[18px] font-medium leading-[1.1] tracking-[-0.02em] text-[var(--text-1)] truncate" title={typeof value === "string" ? value : undefined}>{value}</div>
      )}
      {sub && <div className="mt-1 text-[11px] text-[var(--text-3)] truncate" title={typeof sub === "string" ? sub : undefined}>{sub}</div>}
    </div>
  );
  const grossLines = [...totals].filter((t) => t.deposits > 0).sort((a, b) => b.amountEur - a.amountEur).map((t) => money0(t.currency, t.amountLocal));
  // Export (Jasiel 2026-09-10: every card exports). One flat file a spreadsheet can pivot: the
  // strip's numbers as `currency_total` rows, then one `day` row per day of the window, always
  // DAILY even when the chart has bucketed into weeks, because the weekly bars are a display
  // choice and the data underneath is daily. Days outside the records say captured=no so an
  // empty day cannot be read as a day with no deposits. Client-side from the data in hand; the
  // shared csvCell guards quoting and formula injection, the BOM keeps Excel's encoding honest.
  const exportCsv = () => {
    if (!d) return;
    const head = ["row", "key", "deposits", "players", "amount_local", "amount_eur", "deposits_before_contact", "captured"];
    const rows: (string | number | null)[][] = [];
    rows.push(["depositors_in_window", "", "", d.depositors, "", "", "", ""]);
    for (const t of totals) rows.push(["currency_total", t.currency, t.deposits, t.players, t.amountLocal, t.amountEur, t.before, ""]);
    for (const day of days) {
      const x = byDay.get(day);
      rows.push(["day", day, x?.deposits ?? 0, x?.players ?? 0, "", x?.amountEur ?? 0, x?.depositsBefore ?? 0, covered(day) ? "yes" : "no"]);
    }
    const csv = CSV_BOM + [head, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n");
    const stem = days.length ? `${days[0]}_${days[days.length - 1]}` : d.to.slice(0, 10);
    // The file names the filters it was cut with, so two exports from the same window cannot be confused.
    const tag = filterWords ? "_" + filterWords.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) : "";
    triggerDownload(new Blob([csv], { type: "text/csv;charset=utf-8;" }), `audience-deposits_${stem}${tag}.csv`);
  };
  return (
    <section className="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl overflow-hidden" aria-label="Deposits by day">
      {!d && !unavailable && (
        <div className="grid grid-cols-4 max-[820px]:grid-cols-2 border-b border-[var(--border)]" aria-label="Money in the window" aria-busy="true">
          {["Deposits", "Depositors", "Gross", "Average"].map((label) => (
            <div key={label} className="px-4 py-3 border-l border-[var(--border)] first:border-l-0 min-w-0">
              <div className="text-[10px] uppercase tracking-[.07em] text-[var(--text-4)] mb-1">{label}</div>
              <Pulse w="w-20" h="h-[18px]" />
              <div className="mt-1"><Pulse w="w-28" h="h-2.5" /></div>
            </div>
          ))}
        </div>
      )}
      {d && d.totals && (
        <div className="grid grid-cols-4 max-[820px]:grid-cols-2 border-b border-[var(--border)]" aria-label="Money in the window">
          {stat("Deposits", fmt(depCount), (before ? `${fmt(before)} more before contact, not counted` : "after contact, in this window") + who,
            "Deposits made at or after the first call or text, inside the window. Earlier ones are named below, never counted. "
            + "This strip follows the filters on the Depositors table below: set one and it counts only those players' deposits.")}
          {stat("Depositors", d.depositors == null ? "—" : fmt(d.depositors),
            (depCount && d.depositors ? `${(depCount / d.depositors).toFixed(1)} deposits each · deposited in this window` : "deposited in this window") + who,
            "Players who deposited inside this window, counted once each, however long ago they were first contacted. "
            + "Follows the Depositors table's filters: with a filter set, only those players. "
            + "The Reach card below asks a narrower question on the same window: of the players touched INSIDE it, "
            + "how many deposited after that touch. Both use the same after-contact rule, so a player first contacted "
            + "inside the window is in both numbers, and one contacted earlier is only in this one.")}
          {stat("Gross", depCount && grossLines.length ? grossLines : "—", depCount ? `EUR ${Math.round(eur).toLocaleString("en-US")} normalised` : undefined,
            "Amounts per currency, never added together. The EUR line is the CRM's own conversion.")}
          {stat("Average", depCount ? `EUR ${(eur / depCount).toFixed(2)}` : "—", depCount ? "per deposit, normalised" : undefined,
            "The EUR total divided by the number of deposits in the window.")}
        </div>
      )}
      <div className="px-[18px] py-4">
        <div className="flex items-baseline gap-2.5 mb-0.5">
          <h2 className="text-[12.5px] font-medium text-[var(--text-2)] flex items-center gap-[5px]">
            Deposits by {weekly ? "week" : "day"}
            <Info text={`Deposits made after the first call or text, counted on the ${weekly ? "week" : "day"} each deposit happened. ${weekly ? "Weeks run Sunday to Saturday. The window is too long for a bar a day. " : ""}Days marked not captured are outside the records${coverageWords ? `, which cover ${coverageWords}` : ""}.`} />
          </h2>
          <span className="ml-auto font-mono text-[10.5px] text-[var(--text-4)]">
            {d && days.length ? `${mmdd(days[0])} → ${mmdd(days[days.length - 1])} · ${fmt(total)} deposit${total === 1 ? "" : "s"}` : ""}
          </span>
          <button
            type="button"
            onClick={exportCsv}
            disabled={!d}
            aria-label="Export deposits"
            title="The four numbers above, per currency, and the deposits for every day in the window, one row per day. Opens in Excel."
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium border border-[var(--border)] text-[var(--text-2)] hover:text-[var(--text-1)] hover:border-[var(--border-2)] transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Download size={12} /> Export
          </button>
        </div>
        {!d && unavailable ? (
          <p className="text-[11.5px] text-[var(--text-4)] py-3">Not available yet.</p>
        ) : !d ? (
          <div className="relative mt-[22px]" aria-label="Loading deposits by day" aria-busy="true">
            <div className="flex items-end gap-[3px] h-16">
              {Array.from({ length: 14 }, (_, i) => (
                <span key={i} className="flex-1 rounded-t-[2px] bg-[var(--bg-elevated)] animate-pulse" style={{ height: `${18 + ((i * 37) % 60)}%` }} />
              ))}
            </div>
            <div className="mt-1 h-[10px]" />
          </div>
        ) : (
          <div className="relative mt-[22px]">
            <div className="flex items-end gap-[3px]">
              {buckets.map((b) => {
                const n = sum(b, (x) => x.deposits);
                const players = sum(b, (x) => x.players);
                const gap = b.days.every((day) => !covered(day));
                const partial = b.days.includes(today);
                const tip = gap
                  ? "not captured"
                  : n
                    ? `${fmt(n)} deposit${n === 1 ? "" : "s"} · ${fmt(players)} player${players === 1 ? "" : "s"}${weekly ? " (players may repeat across days)" : ""}`
                    : "no deposits";
                return (
                  <span key={b.key} className="group flex-1 relative flex flex-col items-center min-w-0" role="img" aria-label={`${weekly ? "week of " : ""}${mmdd(b.key)} ${tip}${partial ? ", today, still running" : ""}`}>
                    <span className="pointer-events-none absolute bottom-[calc(100%+6px)] left-1/2 -translate-x-1/2 whitespace-nowrap rounded-md border border-[var(--border-2)] bg-[var(--bg-elevated)] px-2 py-1 font-mono text-[10.5px] text-[var(--text-2)] opacity-0 transition-opacity group-hover:opacity-100 z-10">
                      {weekly ? `week of ${mmdd(b.key)}` : mmdd(b.key)} · {tip}{partial ? " · today, still running" : ""}
                    </span>
                    <span className="h-16 w-full flex items-end">
                      <span
                        className={`w-full rounded-t-[2px] transition-[filter] group-hover:brightness-[1.18] ${n && !gap ? "" : "bg-[var(--bg-hover)]"} ${partial ? "opacity-45" : ""}`}
                        style={n && !gap ? { height: `${((n / peak) * 100).toFixed(1)}%`, background: ROW_COLOR.reached, minHeight: 1 } : { height: 2 }}
                      />
                    </span>
                    <span className={`mt-1 font-mono text-[8.5px] group-hover:text-primary ${gap ? "text-[var(--text-4)]/40" : "text-[var(--text-4)]"} ${buckets.length > 45 && buckets.indexOf(b) % 2 ? "invisible" : ""}`}>{b.label}</span>
                  </span>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
