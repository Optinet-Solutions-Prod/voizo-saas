"use client";

// The Audience tab's aggregate cards, ported from the 2026-08-25 v4 mockup, functions read whole:
//   MembersStat    `stats()`, first tile only. The two lift tiles (the frozen 25 Aug study) stay off
//                  until live deposits cover a real window (Jasiel 2026-09-07).
//   ReachCard      `channels()`: independent bars on ONE denominator, NOT a funnel. Measured
//                  2026-09-01, 76-86% of texted players were never in a conversation, so nested or
//                  tapering bars would state something false about our own operation. Under Texted,
//                  the texts themselves by delivery receipt, in TEXTS; players above, texts below,
//                  the two units never share a bar. Emailed reads "none yet", never 0%. A fifth bar
//                  since 2026-09-07 (Jasiel: "a summary of gross deposited from players"):
//                  Deposited after contact, lifetime like the others, with the gross per currency.
//   DepositsByDay  `whenMoney()` (VOZ-481): one bar per calendar day on the range control's window,
//                  weekly bars past 92 days. Bars are DEPOSITS; the tooltip says how many players
//                  made them, in words. A day outside what the table holds reads "not captured",
//                  never "no deposits". A money strip at the top (2026-09-07): deposits, depositors,
//                  gross per currency never summed across currencies, the CRM's EUR-normalised total.
//
// "Reached", not the mockup's "Spoke with a person": the RPC behind this card is the dashboard's
// lean rule (connected and not the voicemail bucket, no transcript), and Reached is the word the
// dashboard already uses for exactly that predicate. The transcript classifier's "conversation"
// is a different, smaller number and is never labelled as this one.
import { Info } from "../analytics/ConnectRateHero";
import { ROW_COLOR } from "../analytics/PerformanceCards";
import type { AudienceDeposits, AudienceLastTouch, DepositTotal, LastTouchBucket, LaneReach, LifetimeDeposited } from "../api/audience/reach/route";

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
/** Per-currency gross, largest first; never a sum across currencies. */
const grossLine = (totals: DepositTotal[]) => [...totals].filter((t) => t.deposits > 0).sort((a, b) => b.amountEur - a.amountEur).map((t) => money0(t.currency, t.amountLocal)).join(" + ");

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

function Row({ label, n, members, color, note, pending, ariaLabel }: { label: string; n: number; members: number; color: string; note: string; pending?: boolean; ariaLabel?: string }) {
  const p = members ? (100 * n) / members : 0;
  const muted = pending ? "text-[var(--text-4)]" : "";
  return (
    <div className={`${TRACK} py-[5px] text-[12px]`} role="row" aria-label={ariaLabel ?? label}>
      <span className="text-[var(--text-2)] flex items-center gap-[5px]">
        {label} <Info text={note} />
      </span>
      <span className="h-[7px] rounded-[4px] bg-[var(--bg-elevated)] overflow-hidden">
        <span className="block h-full rounded-[4px]" style={{ width: `${Math.max(p, n ? 0.6 : 0).toFixed(2)}%`, background: color }} />
      </span>
      <span className={`font-mono text-[13px] text-right ${muted || "text-[var(--text-1)]"}`}>{pending ? "" : `${p.toFixed(1)}%`}</span>
      <span className={`font-mono text-[11.5px] text-right ${muted || "text-[var(--text-3)]"}`}>{pending ? "none yet" : fmt(n)}</span>
    </div>
  );
}

// ── What came before the deposit (VOZ-509, Jasiel 2026-09-08) ──
// Deliberately NOT called attribution. Every deposit is bucketed by the latest Voizo touch before
// it, and the empty bucket is named "No Voizo touch we can see" because that is all we know:
// cio_events holds deposits and nothing else, so a CRM email or a bonus is invisible to us and
// lands here. Measured 2026-09-08, that bucket is 72% at 7d. Calling it "organic" would state
// something false. Proximity is not lift either (25 Aug: contacted and never-reached players
// deposit at the same rate), so the note says so where the numbers are read.
const TOUCH_ROWS: { bucket: LastTouchBucket["bucket"]; label: string; color: string; note: string }[] = [
  { bucket: "call_spoke", label: "Spoke", color: ROW_COLOR.reached,
    note: "A call that connected and lasted 30 seconds or more." },
  { bucket: "sms_delivered", label: "Text delivered", color: ROW_COLOR.neutral,
    note: "A text the phone confirmed it received. Whether they read it or tapped the link is unknown." },
  { bucket: "call", label: "Called", color: ROW_COLOR.unreachable,
    note: "A call that did not become a conversation: no answer, voicemail, or under 30 seconds." },
  { bucket: "sms", label: "Texted", color: ROW_COLOR.voicemail,
    note: "A text with no delivery confirmation, so it is not known whether it arrived." },
  { bucket: "none", label: "No touch on record", color: ROW_COLOR.declined,
    note: "No call or text on record in that window. This is not 'organic': CRM emails and bonuses are not visible here, so those land here too." },
];

export function LastTouchCard({ lastTouch, unavailable }: { lastTouch: AudienceLastTouch | null; unavailable?: string }) {
  const byBucket = new Map((lastTouch?.buckets ?? []).map((b) => [b.bucket, b]));
  const total = (lastTouch?.buckets ?? []).reduce((a, b) => a + b.deposits, 0);
  const hours = lastTouch?.windowHours ?? 168;
  const windowWord = hours === 24 ? "24 hours" : hours === 72 ? "72 hours" : "7 days";
  const reached = TOUCH_ROWS.filter((r) => r.bucket !== "none").reduce((a, r) => a + (byBucket.get(r.bucket)?.deposits ?? 0), 0);
  return (
    <section className="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl px-[18px] py-4" aria-label="What came before the deposit">
      <div className="flex items-baseline gap-2.5 mb-0.5">
        <h2 className="text-[12.5px] font-medium text-[var(--text-2)] flex items-center gap-[5px]">
          What came before the deposit
          <Info text={`Each deposit in this window, matched to the last call or text before it, within ${windowWord}. Shows what came first, not what caused it.`} />
        </h2>
        <span className="ml-auto font-mono text-[10.5px] text-[var(--text-4)]">{lastTouch ? `${fmt(total)} deposits · last ${windowWord}` : ""}</span>
      </div>
      {!lastTouch && unavailable ? (
        <p className="text-[11.5px] text-[var(--text-4)] py-3">Not available yet.</p>
      ) : !lastTouch ? (
        <div aria-label="Loading what came before the deposit" aria-busy="true">
          {TOUCH_ROWS.map((r) => (
            <div key={r.bucket} className={`${TRACK} py-[5px] text-[12px]`}>
              <span className="text-[var(--text-3)]">{r.label}</span>
              <span className="h-[7px] rounded-[4px] bg-[var(--bg-elevated)] overflow-hidden animate-pulse" />
              <span className="text-right"><Pulse w="w-9" /></span>
              <span className="text-right"><Pulse w="w-12" /></span>
            </div>
          ))}
        </div>
      ) : total === 0 ? (
        <p className="text-[11.5px] text-[var(--text-4)] py-3">No deposits in this window.</p>
      ) : (
        <>
          {TOUCH_ROWS.map((r) => (
            <Row key={r.bucket} label={r.label} n={byBucket.get(r.bucket)?.deposits ?? 0} members={total} color={r.color} note={r.note} />
          ))}
          <p className="mt-2 font-mono text-[10.5px] text-[var(--text-4)]">
            {fmt(reached)} of {fmt(total)} deposits came after a call or text. Order, not cause.
          </p>
        </>
      )}
    </section>
  );
}

export function ReachCard({ reach, deposited, unavailable }: { reach: LaneReach | null; deposited: LifetimeDeposited | null; unavailable?: string }) {
  const m = reach;
  const tp = (n: number) => (m && m.msgs ? `${((100 * n) / m.msgs).toFixed(1)}%` : "—");
  const notReached = m && m.texted ? Math.round((100 * m.texted_not_spoken) / m.texted) : null;
  const depTotals = deposited?.totals ?? [];
  const depCount = depTotals.reduce((a, t) => a + t.deposits, 0);
  const depEur = depTotals.reduce((a, t) => a + t.amountEur, 0);
  return (
    <section className="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl px-[18px] py-4" aria-label="Reach">
      <div className="flex items-baseline gap-2.5 mb-0.5">
        <h2 className="text-[12.5px] font-medium text-[var(--text-2)] flex items-center gap-[5px]">
          Reach
          <Info text="How many of those players each channel reached. Bars count people, not attempts, and they overlap: one player can be in several." />
        </h2>
        <span className="ml-auto font-mono text-[10.5px] text-[var(--text-4)]">{m ? `of ${fmt(m.members)} players ever loaded` : ""}</span>
      </div>
      {!m && unavailable ? (
        <p className="text-[11.5px] text-[var(--text-4)] py-3">Not available yet.</p>
      ) : !m ? (
        <div aria-label="Loading reach" aria-busy="true">
          {["Dialled", "Reached", "Texted", "Emailed", "Deposited"].map((label) => (
            <div key={label} className={`${TRACK} py-[5px] text-[12px]`}>
              <span className="text-[var(--text-3)]">{label}</span>
              <span className="h-[7px] rounded-[4px] bg-[var(--bg-elevated)] overflow-hidden animate-pulse" />
              <span className="text-right"><Pulse w="w-9" /></span>
              <span className="text-right"><Pulse w="w-12" /></span>
            </div>
          ))}
        </div>
      ) : (
        <>
          <Row label="Dialled" n={m.dialled} members={m.members} color={ROW_COLOR.unreachable}
            note="At least one call attempt. Whether it connected is the connect rate above." />
          <Row label="Reached" n={m.spoke_lean} members={m.members} color={ROW_COLOR.reached}
            note="The call connected and was not voicemail. A pickup with nobody talking still counts here." />
          <Row label="Texted" n={m.texted} members={m.members} color={ROW_COLOR.neutral}
            note="At least one text sent. Not a subset of Reached: most texted players were never spoken to. The thin bar below is the texts." />
          {m.msgs > 0 && (
            <div className={`${TRACK} items-start pb-[7px]`}>
              <span />
              <span className="flex h-1 rounded-[2px] overflow-hidden mt-px" aria-hidden>
                <span style={{ flex: m.msgs_delivered, background: ROW_COLOR.reached }} />
                <span style={{ flex: m.msgs_failed, background: ROW_COLOR.declined }} />
                <span style={{ flex: m.msgs_unconfirmed, background: ROW_COLOR.unreachable }} />
              </span>
              <span className="col-start-2 col-end-5 font-mono text-[10.5px] text-[var(--text-4)] flex items-center gap-[5px] flex-wrap mt-[5px]">
                {fmt(m.msgs)} texts: {tp(m.msgs_delivered)} delivered · {tp(m.msgs_failed)} failed · {tp(m.msgs_unconfirmed)} unconfirmed · clicks not tracked
                <Info text="The texts themselves, not people. Delivered: the phone confirmed it. Failed: the network refused it. Unconfirmed: nothing came back yet. Clicks: unknown, not zero, because Mobivate does not report them." />
              </span>
            </div>
          )}
          <Row label="Emailed" n={0} members={m.members} color={ROW_COLOR.voicemail} pending
            note="Follow-up emails after a call. The trigger is sent, but no Customer.io campaign listens for it yet, so nothing goes out. Shown as none yet, not 0%." />
          {deposited ? (
            <>
              <Row label="Deposited" n={deposited.players} members={m.members} color="var(--color-primary)" ariaLabel="Deposited after contact"
                note="Players who deposited at or after the first call or text. Earlier deposits are left out. Order, not cause: contacted and never-reached players deposit at the same rate." />
              <div className={`${TRACK} items-start pb-[7px]`}>
                <span />
                <span className="col-start-2 col-end-5 font-mono text-[10.5px] text-[var(--text-4)] flex items-center gap-[5px] flex-wrap" aria-label="Gross deposited after contact">
                  {depCount ? <>{fmt(depCount)} deposits after contact: {grossLine(depTotals)} · EUR {Math.round(depEur).toLocaleString("en-US")} normalised</> : "no deposit after contact on record"}
                  <Info text="Deposits per currency, never added together. The EUR line is the CRM's own conversion. Total money in, not money the calls caused." />
                </span>
              </div>
            </>
          ) : (
            <Row label="Deposited" n={0} members={m.members} color="var(--color-primary)" pending ariaLabel="Deposited after contact"
              note="Players who deposited at or after the first call or text." />
          )}
          <p className="mt-[11px] pt-2.5 border-t border-[var(--border)] text-[11.5px] text-[var(--text-3)] leading-normal">
            Not a funnel: {notReached == null ? "—" : `${notReached}%`} of texted players were never reached.
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

export function DepositsByDay({ deposits, unavailable }: { deposits: AudienceDeposits | null; unavailable?: string }) {
  const d = deposits;
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
          {stat("Deposits", fmt(depCount), before ? `${fmt(before)} more before contact, not counted` : "after contact, in this window",
            "Deposits made at or after the first call or text, inside the window. Earlier ones are named below, never counted.")}
          {stat("Depositors", d.depositors == null ? "—" : fmt(d.depositors), depCount && d.depositors ? `${(depCount / d.depositors).toFixed(1)} deposits each` : undefined,
            "How many different players made those deposits, counted once each.")}
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
