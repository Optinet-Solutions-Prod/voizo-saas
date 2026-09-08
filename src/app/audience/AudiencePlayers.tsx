"use client";

// Player activity (Audience mockup 2026-08-25, `members()` + `openDrawer()` + `depCell`), slices 4
// and 5 of the wire, and since 2026-09-07 a real QUERY over the whole lane (Jasiel: "groups of players
// who deposited, were contacted, in a window, in a campaign"), not a 100-row sample:
//   - the panel head carries the FILTER BAR, the dashboard's prefixed dropdowns on the elevated
//     surface: Deposited · Contact · Family · Sort. Counts and pages are the database's answer for
//     the whole lane; "no players match" is a fact about the lane, not a page.
//   - columns Phone · Market (All markets only) · Campaign (the FAMILY, "also in …") ·
//     Last 3 calls → · Deposited after contact · Last contact. No name column: the name lives in
//     the drawer's header.
//   - Deposited = after contact switches to the DEPOSITOR VIEW (the 08-26 meeting report as a living
//     view): who touched each depositor and when, newest deposit first. No CRM-messages column: the
//     nightly pull that would feed it does not exist yet, and a column of dashes would claim it ran.
//   - a row opens the mockup's RIGHT-SIDE DRAWER (392px, scrim): phone + sub line, the stat grid, a
//     vertical timeline (calls, texts, deposits, first-contact pin), a legend and a note. Since
//     2026-09-07 the drawer also reads the player's Customer.io footprint LIVE, one player at a time:
//     their CRM name and email (so the row can be found in Customer.io), the messages CIO sent them
//     with human opens and clicks, and their recent events. Escape, the scrim and the ✕ close it.
// The deposit cell has FOUR states, because the column never says less than it knows:
//   after    credited, with the date        before   greyed, "not counted"; hiding it would be a lie
//   none     a dash, never 0.00             no record  we hold no CRM identity, so we cannot say
import { useEffect, useState } from "react";
import { Download, Mail, X } from "lucide-react";
import { CSV_BOM, csvCell, triggerDownload } from "@/lib/download";
import Pagination from "@/components/Pagination";
import StyledSelect from "@/components/StyledSelect";
import SortHead, { nextSort, type SortDir } from "./SortHead";
import { Info } from "../analytics/ConnectRateHero";
import { Pulse } from "./AudienceReach";
import { ROW_COLOR } from "../analytics/PerformanceCards";
import type { Dot } from "@/lib/audienceLane";
import type { AudiencePlayerRow, AudiencePlayersResponse, Contact, Deposited, PlayerDeposit, PlayerEvent, PlayerSort } from "../api/audience/players/route";
import type { PlayerCrmResponse } from "../api/audience/player-crm/route";

export interface PlayerFilters {
  deposited: Deposited;
  contact: Contact;
  /** A family key from /api/audience/reach; "" = any. */
  family: string;
  /** Column sort, applied in the database (the list is a page of a lane-wide query). */
  sort: PlayerSort;
  dir: SortDir;
}
export const DEFAULT_FILTERS: PlayerFilters = { deposited: "any", contact: "any", family: "", sort: "last_contact", dir: "desc" };
const ASC_FIRST: PlayerSort[] = ["phone", "first_contact"];

const DEPOSITED_OPTIONS: { value: Deposited; label: string }[] = [
  { value: "any", label: "Any" },
  { value: "after", label: "After contact" },
  { value: "before", label: "Before contact only" },
  { value: "none", label: "None on record" },
  { value: "unknown", label: "No CRM record" },
];
const CONTACT_OPTIONS: { value: Contact; label: string }[] = [
  { value: "any", label: "Any" },
  { value: "reached", label: "Reached" },
  { value: "texted", label: "Texted" },
  { value: "delivered", label: "SMS delivered" },
  { value: "never", label: "Never reached" },
];

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
// The attempt chip of the depositor view: funnel-furthest of the player's last calls.
const ATTEMPT_LADDER: Dot[] = ["spoke", "silent", "voicemail", "never"];

// The mockup's mmddhm / mmdd, UTC.
const p2 = (n: number) => String(n).padStart(2, "0");
const mmdd = (iso: string | null) => {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : `${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}`;
};
const mmddhm = (iso: string | null) => {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : `${mmdd(iso)} ${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}`;
};
const money = (cur: string, n: number) => `${cur} ${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
/** Sums per currency, sorted largest first. Money is never added across currencies. */
function sums(deps: PlayerDeposit[]): [string, number][] {
  const by = new Map<string, number>();
  for (const d of deps) if (d.amountLocal != null) by.set(d.currency ?? "?", (by.get(d.currency ?? "?") ?? 0) + d.amountLocal);
  return [...by].sort((a, b) => b[1] - a[1]);
}
type DepState = "after" | "before" | "none" | "unknown";
function depState(r: AudiencePlayerRow): DepState {
  if (!r.cioKnown) return "unknown";
  if (r.deposits.some((d) => d.afterContact)) return "after";
  return r.deposits.length ? "before" : "none";
}
/** The first deposit after contact (the mockup's depAt, its lag anchor). */
const firstAfter = (r: AudiencePlayerRow) => r.deposits.filter((d) => d.afterContact).sort((a, b) => (a.at < b.at ? -1 : 1))[0] ?? null;
const lagDays = (r: AudiencePlayerRow) => {
  const f = firstAfter(r);
  return f && r.firstAt ? (Date.parse(f.at) - Date.parse(r.firstAt)) / 86_400_000 : null;
};

function DepCell({ r }: { r: AudiencePlayerRow }) {
  const s = depState(r);
  if (s === "after") {
    const top = sums(r.deposits.filter((d) => d.afterContact))[0];
    return (
      <td className="px-3 py-2 text-right font-mono text-[12px] text-[var(--text-1)] whitespace-nowrap">
        {top ? money(top[0], top[1]) : "—"}
        <small className="block text-[10px] text-[var(--text-4)]">{mmdd(firstAfter(r)?.at ?? null)} · after contact</small>
      </td>
    );
  }
  if (s === "before") {
    const top = sums(r.deposits)[0];
    const latest = [...r.deposits].sort((a, b) => (a.at < b.at ? 1 : -1))[0];
    return (
      <td className="px-3 py-2 text-right font-mono text-[12px] text-[var(--text-4)] whitespace-nowrap">
        {top ? money(top[0], top[1]) : "—"}
        <small className="block text-[10px]">{mmdd(latest?.at ?? null)} · before contact, not counted</small>
      </td>
    );
  }
  if (s === "unknown") {
    return (
      <td className="px-3 py-2 text-right text-[11px] text-[var(--text-4)] whitespace-nowrap">
        no record <Info text="We hold no Customer.io identity for this player, so we cannot say whether they deposited. This is not a zero." />
      </td>
    );
  }
  return <td className="px-3 py-2 text-right text-[var(--text-4)]">—</td>;
}

export default function AudiencePlayers({ data, page, onPage, loading, showMarket, marketLabel, brandLabel, filters, onFilters, familyOptions, searching, onExport, exporting }: {
  data: AudiencePlayersResponse | null;
  /** Export THIS list with THESE filters as CSV (the page owns the fetch; the button lives here,
   *  beside the filters it obeys, since 2026-09-08). */
  onExport: () => void;
  exporting: boolean;
  page: number;
  onPage: (p: number) => void;
  loading: boolean;
  /** All markets: each row names its market, because the phone alone does not. */
  showMarket: boolean;
  /** The market in view for the empty sentences; "" under All markets. */
  marketLabel: string;
  /** The brand in view, for the drawer's sub line; empty under All brands. */
  brandLabel: string;
  filters: PlayerFilters;
  onFilters: (f: PlayerFilters) => void;
  familyOptions: { value: string; label: string }[];
  /** A search needle is active (the page's top-row box), for the empty sentence. */
  searching: boolean;
}) {
  const [open, setOpen] = useState<AudiencePlayerRow | null>(null);
  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;
  const pageSize = data?.pageSize ?? 25;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const onlyDep = filters.deposited === "after";
  const set = (patch: Partial<PlayerFilters>) => onFilters({ ...filters, ...patch });
  // Column sorting runs in the database: a header click changes the query, never the page in hand.
  const sortBy = (k: PlayerSort) => set(nextSort({ sort: filters.sort, dir: filters.dir }, k, ASC_FIRST));
  const head = (label: string, k: PlayerSort, right = false, first = false) => <SortHead label={label} k={k} sort={filters.sort} dir={filters.dir} onSort={sortBy} right={right} first={first} />;

  // Escape closes the drawer, as the mockup's key handler does.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const where = marketLabel || "any market";
  const cols = (onlyDep ? 8 : 6) - (showMarket ? 0 : 1);
  const filtered = filters.deposited !== "any" || filters.contact !== "any" || !!filters.family || searching;
  // The loading case never reaches here: the table renders placeholder rows for it (below), so this
  // string is only ever a genuine empty result.
  const empty = onlyDep
      ? `No player in ${where} deposited after we contacted them in this window${filtered && (filters.contact !== "any" || filters.family || searching) ? " with these filters" : ""}. That is a result, not a gap.`
      : filtered
        ? "No player matches these filters in this window. An empty result is an answer."
        : "No player was contacted in this scope in this window.";
  // Column total, per currency, over the PAGE, and it says so: a footer total that silently means
  // something other than the rows above it is a trap. The window's total sits on the money strip.
  const withDep = rows.filter((r) => depState(r) === "after");
  const totals = sums(withDep.flatMap((r) => r.deposits.filter((d) => d.afterContact)));
  const totalsText = totals.length ? " · " + totals.map(([c, n]) => money(c, n)).join(" + ") : "";
  const th = (label: string, right = false, extra?: string) => (
    <th className={`${right ? "text-right" : "text-left"} px-3 py-2 font-semibold ${extra ?? ""}`}>{label}</th>
  );

  return (
    <>
      <section className="bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl overflow-hidden" aria-label={onlyDep ? "Depositors" : "Player activity"}>
        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-[var(--border)] flex-wrap">
          <h2 className="text-[12.5px] font-medium text-[var(--text-2)]">{onlyDep ? "Depositors" : "Player activity"}</h2>
          {onlyDep && (
            <span className="text-[11px] text-[var(--text-4)] flex items-center gap-1">
              <Info text="Players who deposited after our first call or text to them, inside the window the range control sets, newest deposit first. Proximity is not causation: two independent studies found contacted and never-reached players deposit at the same rate. This view shows WHO touched each depositor and WHEN, so people judge with the evidence in front of them." />
            </span>
          )}
          <div className="flex items-center gap-2 flex-wrap ml-1" aria-label="Player filters">
            <StyledSelect size="sm" prefix="Deposited:" options={DEPOSITED_OPTIONS} value={filters.deposited} onChange={(v) => set({ deposited: v as Deposited })} placeholder="Any" />
            <StyledSelect size="sm" prefix="Contact:" options={CONTACT_OPTIONS} value={filters.contact} onChange={(v) => set({ contact: v as Contact })} placeholder="Any" />
            <StyledSelect size="sm" prefix="Family:" options={[{ value: "", label: "All" }, ...familyOptions]} value={filters.family} onChange={(v) => set({ family: v })} placeholder="All" />
          </div>
          <div className="ml-auto flex items-center gap-2.5">
            <span className="font-mono text-[11px] text-[var(--text-4)]" aria-label="Players shown">{loading && !data ? "" : total.toLocaleString("en-US")}</span>
            <button
              type="button"
              onClick={onExport}
              disabled={exporting || !data || total === 0}
              aria-label="Export players"
              title={data ? `Export these ${total.toLocaleString("en-US")} players as CSV: this list with these filters, not just the page. Opens in Excel.` : "Loading…"}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium border border-[var(--border)] text-[var(--text-2)] hover:text-[var(--text-1)] hover:border-[var(--border-2)] transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Download size={12} /> {exporting ? "Exporting…" : "Export"}
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-[12.5px] border-collapse">
            <thead>
              <tr className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-3)]">
                {head("Phone", "phone", false, true)}
                {showMarket && th("Market")}
                {th("Campaign")}
                {onlyDep ? (
                  <>
                    {th("Attempt")}
                    {head("First contact", "first_contact", true)}
                    {head("Deposit", "first_deposit", true)}
                    {head("Days", "lag", true)}
                    {head("Deposited", "amount", true, true)}
                  </>
                ) : (
                  <>
                    {th("Last 3 calls →")}
                    <th className="text-right px-3 py-2 font-semibold whitespace-nowrap" aria-sort={filters.sort === "amount" ? (filters.dir === "asc" ? "ascending" : "descending") : "none"}>
                      <button type="button" onClick={() => sortBy("amount")} title="Sort by deposited amount" className={`group inline-flex items-center gap-1 uppercase tracking-wider text-[10px] font-semibold transition-colors ${filters.sort === "amount" ? "text-[var(--text-1)]" : "text-[var(--text-3)] hover:text-[var(--text-2)]"}`}>
                        Deposited after contact
                        <span aria-hidden className={`text-[8px] ${filters.sort === "amount" ? "text-primary" : "text-[var(--text-4)] opacity-0 group-hover:opacity-70"}`}>{filters.sort === "amount" && filters.dir === "asc" ? "▲" : "▼"}</span>
                      </button>
                      {" "}<Info text="Only deposits made after our first call or text to the player, as Customer.io reported them. Earlier deposits are shown greyed and not counted. A dash means no deposit on record; no record means we hold no identity to check." />
                    </th>
                    {head("Last contact", "last_contact", true, true)}
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && loading && !data ? (
                // Placeholder rows the shape of the real ones, so the table keeps its height and the
                // operator sees where each column will land (the AudienceReach pattern). A genuine
                // empty result still gets its sentence below.
                [0, 1, 2, 3, 4].map((i) => (
                  <tr key={i} className="border-t border-[var(--border)]" aria-busy="true">
                    {Array.from({ length: cols }).map((_, c) => (
                      <td key={c} className={`px-4 py-[7px] ${c >= cols - 2 ? "text-right" : ""}`}>
                        <Pulse w={c === 0 ? "w-28" : c === cols - 1 ? "w-16" : i % 2 ? "w-14" : "w-20"} />
                      </td>
                    ))}
                  </tr>
                ))
              ) : rows.length === 0 ? (
                <tr><td colSpan={cols} className="px-4 py-8 text-center text-xs text-[var(--text-3)] border-t border-[var(--border)]">{empty}</td></tr>
              ) : (
                rows.map((r) => {
                  const attempt = ATTEMPT_LADDER.find((d) => r.dots.includes(d)) ?? "never";
                  const fa = firstAfter(r);
                  const lag = lagDays(r);
                  return (
                    <tr
                      key={r.phone}
                      onClick={() => setOpen(r)}
                      className={`border-t border-[var(--border)] hover:bg-[var(--bg-hover)] cursor-pointer transition-colors ${loading ? "opacity-60" : ""}`}
                    >
                      <td className="px-4 py-2 font-mono text-[var(--text-1)] whitespace-nowrap">{r.phone}</td>
                      {showMarket && <td className="px-3 py-2 font-mono text-[11px] text-[var(--text-3)]">{r.market || "—"}</td>}
                      <td className="px-3 py-2 text-[var(--text-2)]">
                        {r.campaignLabel}
                        {!onlyDep && r.alsoIn.length > 0 && <> · <span className="text-primary">also in {r.alsoIn.join(", ")}</span></>}
                      </td>
                      {onlyDep ? (
                        <>
                          <td className="px-3 py-2">
                            <span className="text-[10px] px-[7px] py-px rounded-full border whitespace-nowrap" style={{ color: DOT_COLOR[attempt], borderColor: DOT_COLOR[attempt] }}>{DOT_LABEL[attempt][0]}</span>
                          </td>
                          <td className="px-3 py-2 text-right font-mono text-[11px] text-[var(--text-4)] whitespace-nowrap">{mmddhm(r.firstAt)}</td>
                          <td className="px-3 py-2 text-right font-mono text-[11px] text-[var(--text-4)] whitespace-nowrap">{mmddhm(fa?.at ?? null)}</td>
                          <td className="px-3 py-2 text-right font-mono text-[11px] text-[var(--text-4)] whitespace-nowrap">{lag == null ? "—" : `${lag.toFixed(1)}d`}</td>
                          <DepCell r={r} />
                        </>
                      ) : (
                        <>
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
                          <DepCell r={r} />
                          <td className="px-4 py-2 text-right font-mono text-[11px] text-[var(--text-4)] whitespace-nowrap">{mmddhm(r.lastAt)}</td>
                        </>
                      )}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <div className="flex items-center gap-[13px] flex-wrap px-4 py-2 border-t border-[var(--border)] text-[11px] text-[var(--text-4)]">
          {!onlyDep && (Object.keys(DOT_LABEL) as Dot[]).map((d) => (
            <span key={d} className="inline-flex items-center gap-[5px]">
              <i className="inline-block w-2 h-2 rounded-[2px]" style={{ background: DOT_COLOR[d] }} />
              {DOT_LABEL[d][0]}
            </span>
          ))}
          <span className="text-[var(--text-3)]">
            {rows.length ? (onlyDep ? `${withDep.length} on this page${totalsText}` : `${withDep.length} of ${rows.length} on this page deposited after contact${totalsText}`) : ""}
          </span>
          <span className="ml-auto">
            <Pagination currentPage={Math.min(page, pages)} totalPages={pages} totalItems={total} pageSize={pageSize} onPageChange={onPage} noun={onlyDep ? "depositors" : "players"} />
          </span>
        </div>
      </section>

      {open && <PlayerDrawer row={open} brandLabel={brandLabel} onClose={() => setOpen(null)} />}
    </>
  );
}

// ── the drawer: the mockup's, plus the live Customer.io footprint (2026-09-07) ──
// The journey is a STORY, not a log (Jasiel 2026-09-07: "still looks a bit confusing"): grouped by day,
// one plain line per event in the operator's words ("We called · voicemail, 14 s", "Deposited AUD 70",
// "Customer.io emailed: Your deposit has been received · opened", "Logged in"), two sources told apart
// by colour (Voizo, Customer.io) with the money and the first-contact pin standing out. Balance-update
// events and our own deposit hooks are left out: they repeat what the deposit line already says.
// `message` is for the operator, in plain words; `detail` is the technical reason, hover-only.
type CrmState = { status: "loading" } | { status: "none" } | { status: "ready"; data: PlayerCrmResponse[] } | { status: "error"; message: string; detail: string };
type CrmFetchError = Error & { detail?: string };
type Source = "voizo" | "cio" | "dep" | "pin";
const SOURCE_COLOR: Record<Source, string> = { voizo: ROW_COLOR.neutral, cio: ROW_COLOR.voicemail, dep: "var(--color-primary)", pin: "var(--text-3)" };
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dayLabel = (iso: string) => { const d = new Date(iso); return `${DOW[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`; };
const hhmm = (iso: string) => { const d = new Date(iso); return `${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}`; };
const secs = (n: number | null | undefined) => (!n ? "" : n >= 60 ? `${Math.floor(n / 60)} min ${n % 60} s` : `${n} s`);
// The lean attempt tag in the operator's words. "spoke" never becomes "said yes": goal_reached is not agreement.
const callLine = (e: PlayerEvent) => {
  const d = secs(e.durationSeconds);
  switch (e.what) {
    case "voicemail": return `We called · voicemail${d ? `, ${d}` : ""}`;
    case "unreachable": return "We called · no answer";
    case "silent_pickup": case "early_hangup": return `We called · answered, no conversation${d ? `, ${d}` : ""}`;
    default: return `We called · spoke${d ? `, ${d}` : ""}`;
  }
};
const smsLine = (e: PlayerEvent) => `We texted · ${e.what === "delivered" ? "delivered" : e.what === "sent" ? "sent, not confirmed" : e.what.replace(/_/g, " ")}`;
const CRM_VERB: Record<string, string> = { email: "emailed", in_app: "showed an in-app message", push: "sent a push", sms: "texted" };
const crmMessageLine = (m: PlayerCrmResponse["messages"][number]) => {
  const verb = CRM_VERB[m.type] ?? `sent a ${m.type}`;
  const state = m.failedAt ? " · failed" : m.clickedAt ? " · clicked" : m.openedAt ? " · opened" : "";
  return `Customer.io ${verb}${m.type === "email" && m.name ? `: ${m.name}` : ""}${state}`;
};
const CRM_EVENT: Record<string, string> = {
  login_activity_status: "Logged in", login_failed: "Login failed", bonuses_issued: "Bonus issued", freespin_bonus_issued: "Free spins issued",
  sportsbook_bonus_issued: "Sportsbook bonus issued", deposit_canceled: "Deposit cancelled", cashout_requested: "Cash-out requested",
  cashout_approved: "Cash-out approved", cashout_canceled: "Cash-out cancelled", password_change: "Password changed",
  reset_password_instructions: "Password reset requested", user_verified: "Account verified", document_not_approved: "Document not approved",
  user_limit_created: "Deposit limit set", user_limit_disabled: "Deposit limit removed", status_suspended: "Account suspended",
};
const SKIP_EVENTS = new Set(["deposit_made", "player_balance", "email_status", "confirmation_instructions", "unlock_instructions", "password_compromised"]);
const crmEventLine = (name: string) => CRM_EVENT[name] ?? name.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());

// ── every CRM message, one line each (Jasiel 2026-09-08: "it's a summary, can we make that actually
// viewable?"). The stat line "76 · 16 opened · 6 clicked" opens this; same centred chrome as the
// dashboard's recordings popup (PromptModal / CallDetailModal). Nothing is fetched here: the drawer
// already holds every message with its timestamps, this only stops collapsing them into one line.
type CrmMsg = PlayerCrmResponse["messages"][number];
const CRM_TYPE: Record<string, string> = { email: "email", in_app: "in-app", push: "push", sms: "SMS" };
// What the player did with it, strongest evidence first: the same precedence the journey line uses.
// Opened and clicked both show when both happened; that is the interaction Jasiel asked to see.
const crmStates = (m: CrmMsg): { word: string; at: string | null; hot: boolean }[] => {
  if (m.failedAt) return [{ word: "failed", at: m.failedAt, hot: false }];
  const hot: { word: string; at: string | null; hot: boolean }[] = [];
  if (m.openedAt) hot.push({ word: "opened", at: m.openedAt, hot: true });
  if (m.clickedAt) hot.push({ word: "clicked", at: m.clickedAt, hot: true });
  if (hot.length) return hot;
  return [m.deliveredAt ? { word: "delivered", at: m.deliveredAt, hot: false } : m.sentAt ? { word: "sent", at: m.sentAt, hot: false } : { word: "queued", at: m.createdAt, hot: false }];
};

function CrmMessagesModal({ messages, pulledAt, phone, onClose }: { messages: CrmMsg[]; pulledAt: string | null; phone: string; onClose: () => void }) {
  // Per-player export (Jasiel 2026-09-08: "can those data be extracted too?"): the same rows the
  // popup shows, one line per message, every timestamp as a column so a spreadsheet can pivot by
  // subject. Client-side from the data already in hand; the shared csvCell guards quoting and
  // formula injection, the BOM keeps Excel's encoding detection honest.
  const exportCsv = () => {
    const head = ["day_utc", "time_utc", "type", "subject", "created_at", "sent_at", "delivered_at", "opened_at", "clicked_at", "failed_at", "interaction"];
    const rows = messages.map((m) => [
      (m.createdAt ?? "").slice(0, 10), m.createdAt ? hhmm(m.createdAt) : "", CRM_TYPE[m.type] ?? m.type, m.name,
      m.createdAt, m.sentAt, m.deliveredAt, m.openedAt, m.clickedAt, m.failedAt,
      m.failedAt ? "failed" : m.clickedAt ? "clicked" : m.openedAt ? "opened" : "",
    ]);
    const csv = CSV_BOM + [head, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n");
    triggerDownload(new Blob([csv], { type: "text/csv;charset=utf-8;" }), `crm-messages_${phone.replace(/\D/g, "")}_${new Date().toISOString().slice(0, 10)}.csv`);
  };
  useEffect(() => {
    // The players list closes the DRAWER on Escape from a window listener; document listeners run
    // first in the bubble, so stopping here makes Escape close only this popup. Second Escape, drawer.
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } };
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, [onClose]);
  const opened = messages.filter((m) => m.openedAt).length;
  const clicked = messages.filter((m) => m.clickedAt).length;
  const byType = [...messages.reduce((acc, m) => acc.set(m.type, (acc.get(m.type) ?? 0) + 1), new Map<string, number>())]
    .sort((a, b) => b[1] - a[1]).map(([t, n]) => `${n} ${CRM_TYPE[t] ?? t}`).join(" · ");
  // newest first, grouped by UTC day like the journey
  const days: { day: string; items: CrmMsg[] }[] = [];
  for (const m of [...messages].sort((p, q) => ((p.createdAt ?? "") < (q.createdAt ?? "") ? 1 : -1))) {
    const key = (m.createdAt ?? "").slice(0, 10);
    const last = days[days.length - 1];
    if (last && last.day === key) last.items.push(m); else days.push({ day: key, items: [m] });
  }
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60" onClick={onClose}>
      <div role="dialog" aria-label="CRM messages" className="bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl shadow-2xl w-full max-w-3xl max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-4 px-5 py-4 border-b border-[var(--border)]">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-[var(--text-1)]">
              <Mail size={15} className="shrink-0" />
              <span className="font-semibold">{messages.length.toLocaleString("en-US")} CRM messages</span>
              <span className="font-mono text-[11.5px] text-[var(--text-3)]">· {opened} opened · {clicked} clicked</span>
            </div>
            <p className="text-[11px] text-[var(--text-3)] mt-1">
              Everything Customer.io sent this player{byType ? ` (${byType})` : ""}, newest first, read live{pulledAt ? ` at ${hhmm(pulledAt)} UTC` : ""}. Opened and clicked count people; opens by mail scanners never count.
            </p>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <button type="button" onClick={exportCsv} aria-label="Export CRM messages as CSV" title="One row per message, every timestamp as a column, opens in Excel"
              className="inline-flex items-center gap-1.5 text-[11px] px-2.5 py-1 rounded-md border border-[var(--border)] text-[var(--text-2)] hover:text-[var(--text-1)] hover:border-[var(--border-2)] transition-colors">
              <Download size={12} /> Export CSV
            </button>
            <button type="button" onClick={onClose} aria-label="Close" className="text-[var(--text-3)] hover:text-[var(--text-1)] transition-colors"><X size={18} /></button>
          </div>
        </div>
        <div className="px-5 py-3 overflow-y-auto" aria-label="CRM message list">
          {days.map(({ day, items }) => (
            <section key={day || "undated"} className="mb-3">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-4)] py-1">{day ? dayLabel(`${day}T00:00:00Z`) : "Undated"}</div>
              {items.map((m) => {
                const states = crmStates(m);
                const interacted = states.some((s) => s.hot);
                return (
                  <div key={m.id} role="row" className={`grid grid-cols-[44px_52px_1fr_auto] items-baseline gap-x-3 py-[5px] border-t border-[var(--border)] text-[12px] ${interacted ? "" : "text-[var(--text-3)]"}`}>
                    <span className="font-mono text-[10.5px] text-[var(--text-4)]">{m.createdAt ? hhmm(m.createdAt) : ""}</span>
                    <span className="text-[10px] px-[6px] py-px rounded-full border border-[var(--border-2)] text-[var(--text-4)] whitespace-nowrap text-center">{CRM_TYPE[m.type] ?? m.type}</span>
                    <span className={`truncate ${interacted ? "text-[var(--text-1)]" : ""}`} title={m.name || undefined}>{m.name || <i className="text-[var(--text-4)]">no subject</i>}</span>
                    <span className="flex items-center gap-[6px] whitespace-nowrap">
                      {states.map((s) => (
                        <span key={s.word} aria-label={s.word} className={`text-[10px] px-[7px] py-px rounded-full border ${s.hot ? "" : "border-[var(--border-2)] text-[var(--text-4)]"}`}
                          style={s.hot ? { color: ROW_COLOR.reached, borderColor: ROW_COLOR.reached } : s.word === "failed" ? { color: ROW_COLOR.declined, borderColor: ROW_COLOR.declined } : undefined}>
                          {s.word}{s.at ? ` ${hhmm(s.at)}` : ""}
                        </span>
                      ))}
                    </span>
                  </div>
                );
              })}
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}

function PlayerDrawer({ row: open, brandLabel, onClose }: { row: AudiencePlayerRow; brandLabel: string; onClose: () => void }) {
  const [crm, setCrm] = useState<CrmState>(open.cio.length ? { status: "loading" } : { status: "none" });
  const [crmOpen, setCrmOpen] = useState(false);
  useEffect(() => {
    if (!open.cio.length) return;
    const ctrl = new AbortController();
    Promise.all(
      open.cio.map((c) =>
        fetch(`/api/audience/player-crm?workspace=${encodeURIComponent(c.workspace)}&cio=${encodeURIComponent(c.cioId)}`, { cache: "no-store", signal: ctrl.signal })
          .then(async (r) => {
            if (!r.ok) {
              // Operator words, never a status code (Jasiel 2026-09-08: "we don't want the operator's
              // panic because something they thought is breaking"). A 503 is OUR route saying it holds no
              // Customer.io key for this brand; anything else is Customer.io not answering right now.
              // Neither touches the calls, texts or deposits above. The technical reason rides along in
              // `detail` for whoever debugs it, shown on hover only.
              const b = (await r.json().catch(() => null)) as { error?: unknown } | null;
              const err: CrmFetchError = new Error(r.status === 503 ? "Customer.io is not connected for this brand yet" : "Customer.io did not answer just now");
              err.detail = b?.error ? String(b.error) : `HTTP ${r.status}`;
              throw err;
            }
            return r.json() as Promise<PlayerCrmResponse>;
          }),
      ),
    )
      .then((all) => setCrm({ status: "ready", data: all }))
      .catch((e: unknown) => {
        if (e instanceof Error && e.name === "AbortError") return;
        const err = e as CrmFetchError;
        setCrm({ status: "error", message: e instanceof Error ? e.message : "Customer.io did not answer just now", detail: err?.detail ?? (e instanceof Error ? e.message : String(e)) });
      });
    return () => ctrl.abort();
  }, [open.cio]);

  const s = depState(open);
  const crmData = crm.status === "ready" ? crm.data : [];
  const profile = crmData.map((d) => d.profile).find((p) => p && (p.name || p.email)) ?? null;
  const messages = crmData.flatMap((d) => d.messages);
  const crmEvents = crmData.flatMap((d) => d.events).filter((e) => !SKIP_EVENTS.has(e.name));
  const opened = messages.filter((m) => m.openedAt).length;
  const clicked = messages.filter((m) => m.clickedAt).length;
  const pulledAt = crmData[0]?.pulledAt ?? null;
  const partial = crmData.some((d) => d.unavailable.messages || d.unavailable.events);
  const entries: { at: string; source: Source; text: string }[] = [
    ...open.events.map((e) => ({
      at: e.at,
      source: (e.kind === "dep" ? "dep" : "voizo") as Source,
      text: e.kind === "sms" ? smsLine(e) : e.kind === "dep" ? `Deposited ${e.what}${open.firstAt && e.at < open.firstAt ? " · before we contacted them" : ""}` : callLine(e),
    })),
    ...(open.firstAt ? [{ at: open.firstAt, source: "pin" as Source, text: "First contact" }] : []),
    ...messages.slice(0, 8).map((m) => ({ at: m.sentAt ?? m.createdAt ?? "", source: "cio" as Source, text: crmMessageLine(m) })),
    ...crmEvents.slice(0, 10).map((e) => ({ at: e.at, source: "cio" as Source, text: crmEventLine(e.name) })),
  ].filter((e) => e.at).sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, 30);
  // grouped by UTC day, newest day first, the entries inside newest first
  const days: { day: string; items: typeof entries }[] = [];
  for (const e of entries) {
    const key = e.at.slice(0, 10);
    const last = days[days.length - 1];
    if (last && last.day === key) last.items.push(e); else days.push({ day: key, items: [e] });
  }

  return (
    <>
      <button type="button" aria-label="Close" onClick={onClose} className="fixed inset-0 z-[90] bg-black/50 cursor-default" />
      <aside
        role="dialog"
        aria-label="Member detail"
        className="fixed top-0 right-0 bottom-0 z-[95] w-[392px] max-w-[92vw] bg-[var(--bg-card)] border-l border-[var(--border)] shadow-2xl flex flex-col"
      >
        <div className="flex items-start gap-2.5 px-[17px] py-[15px] border-b border-[var(--border)]">
          <div className="min-w-0">
            <div className="font-mono text-[14px] text-[var(--text-1)]">{open.phone}</div>
            <div className="text-[11px] text-[var(--text-4)] mt-[3px] truncate">
              {[brandLabel, open.campaignLabel, open.alsoIn.length ? `also in ${open.alsoIn.join(", ")}` : ""].filter(Boolean).join(" · ")}
            </div>
            {/* The CRM identity, live: the phone alone does not find a profile in Customer.io. */}
            <div className="text-[11px] mt-[6px] flex flex-col gap-px" aria-label="Customer.io identity">
              {crm.status === "loading" && <span className="text-[var(--text-4)]">Customer.io…</span>}
              {crm.status === "none" && <span className="text-[var(--text-4)]">no Customer.io record</span>}
              {/* Muted like the other neutral states, never amber: nothing on this page is broken, one
                  source is missing. The technical reason sits on hover for whoever debugs it. */}
              {crm.status === "error" && <span className="text-[var(--text-4)]" title={crm.detail}>{crm.message}; the calls, texts and deposits here are unaffected.</span>}
              {crm.status === "ready" && (
                <>
                  <span className="text-[12px] text-[var(--text-1)]">{profile?.name ?? open.name ?? "Name not on the profile"}</span>
                  {profile?.email && <span className="font-mono text-[var(--text-2)] truncate" title={profile.email}>{profile.email}</span>}
                  {open.cio.map((c) => (
                    <span key={c.cioId} className="font-mono text-[10.5px] text-[var(--text-4)] truncate" title="Customer.io id: search it in the People tab">
                      cio {c.workspace} · {c.cioId}
                    </span>
                  ))}
                </>
              )}
            </div>
          </div>
          <button type="button" aria-label="Close" onClick={onClose} className="ml-auto text-[var(--text-3)] hover:text-[var(--text-1)]">
            <X size={15} />
          </button>
        </div>
        <div className="px-[17px] py-[15px] overflow-y-auto">
          <div className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-[7px] mb-5 text-[11.5px]">
            <div className="text-[var(--text-3)]">Calls</div><div className="font-mono text-[12px] text-right text-[var(--text-1)]">{open.calls}</div>
            <div className="text-[var(--text-3)]">SMS</div>
            <div className="font-mono text-[12px] text-right text-[var(--text-1)]">
              {open.smsDelivered ? `${open.smsDelivered} delivered` : open.smsSent ? "sent, not confirmed" : "none"}
            </div>
            <div className="text-[var(--text-3)]">Deposited after contact</div>
            <div className={`font-mono text-[12px] text-right ${s === "after" ? "text-[var(--text-1)]" : "text-[var(--text-4)]"}`}>
              {s === "unknown" ? "no record" : s === "none" ? "none" : s === "before" ? "before contact only" : sums(open.deposits.filter((d) => d.afterContact)).map(([c, n]) => money(c, n)).join(" + ")}
            </div>
            <div className="text-[var(--text-3)] flex items-center gap-1">CRM messages <Info text="Messages Customer.io sent this player (email, in-app, push, SMS), read live when this drawer opened. Opened and clicked count people only; machine opens by mail scanners never enter a number." /></div>
            {crm.status === "ready" && messages.length ? (
              // The summary opens the full list: every message, its subject, and what the player did with it.
              <button type="button" onClick={() => setCrmOpen(true)} aria-label="CRM messages" aria-haspopup="dialog" title="Every message, with opens and clicks"
                className="font-mono text-[12px] text-right text-[var(--text-1)] underline decoration-dotted decoration-[var(--text-4)] underline-offset-[3px] hover:decoration-[var(--text-2)] cursor-pointer justify-self-end">
                {`${messages.length} · ${opened} opened · ${clicked} clicked`}
              </button>
            ) : (
              <div className="font-mono text-[12px] text-right text-[var(--text-4)]" aria-label="CRM messages">
                {crm.status === "ready" ? (partial ? "not available" : "none") : crm.status === "none" ? "no record" : crm.status === "error" ? "not available" : "…"}
              </div>
            )}
          </div>

          {/* The journey, by day. */}
          <div className="flex flex-col gap-3.5" aria-label="Journey">
            {days.map((d) => (
              <section key={d.day}>
                <div className="text-[10px] uppercase tracking-[.07em] text-[var(--text-4)] mb-1.5">{dayLabel(d.day)}</div>
                <div className="border-l border-[var(--border)] pl-4 ml-1 flex flex-col gap-2">
                  {d.items.map((e, i) => (
                    <div key={`${e.at}-${i}`} className="relative flex items-baseline gap-2.5">
                      <span
                        className="absolute -left-5 top-[5px] w-[7px] h-[7px] rounded-full"
                        style={e.source === "pin" ? { background: "var(--bg-card)", border: "1px solid var(--text-3)" } : { background: SOURCE_COLOR[e.source], border: `1px solid ${SOURCE_COLOR[e.source]}` }}
                      />
                      <span className="font-mono text-[10.5px] text-[var(--text-4)] shrink-0 w-[34px]">{hhmm(e.at)}</span>
                      <span className={`text-[12px] leading-snug ${e.source === "pin" ? "font-medium text-[var(--text-1)]" : e.source === "dep" ? "text-[var(--text-1)]" : "text-[var(--text-2)]"}`}>{e.text}</span>
                    </div>
                  ))}
                </div>
              </section>
            ))}
            {crm.status === "loading" && <div className="text-[11px] text-[var(--text-4)]">Reading Customer.io…</div>}
          </div>

          <div className="flex gap-3 flex-wrap mt-4 text-[10.5px] text-[var(--text-4)]">
            <span className="inline-flex items-center gap-[5px]"><i className="inline-block w-[7px] h-[7px] rounded-full" style={{ background: SOURCE_COLOR.voizo }} />Voizo</span>
            <span className="inline-flex items-center gap-[5px]"><i className="inline-block w-[7px] h-[7px] rounded-full" style={{ background: SOURCE_COLOR.cio }} />Customer.io</span>
            <span className="inline-flex items-center gap-[5px]"><i className="inline-block w-[7px] h-[7px] rounded-full" style={{ background: SOURCE_COLOR.dep }} />Deposit</span>
            <span className="inline-flex items-center gap-[5px]"><i className="inline-block w-[7px] h-[7px] rounded-full border border-[var(--text-3)]" />First contact</span>
          </div>
          {/* Sources, one line each, on the stats' margin; nothing here restates the legend. */}
          <dl className="mt-3.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[10.5px] text-[var(--text-4)]" aria-label="Sources">
            <dt className="text-[var(--text-3)]">Voizo</dt><dd>calls and texts, live</dd>
            <dt className="text-[var(--text-3)]">Customer.io</dt>
            <dd>deposits since 26 Jul; messages and events read {crm.status === "ready" && pulledAt ? `${hhmm(pulledAt)} UTC` : "on open"}</dd>
          </dl>
        </div>
      </aside>
      {crmOpen && <CrmMessagesModal messages={messages} pulledAt={pulledAt} phone={open.phone} onClose={() => setCrmOpen(false)} />}
    </>
  );
}
