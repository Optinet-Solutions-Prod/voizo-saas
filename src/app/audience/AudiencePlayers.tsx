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
import { useEffect, useState, type ReactNode } from "react";
import { Download, Mail, MessageSquare, PhoneCall, Search, Wallet, X } from "lucide-react";
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
import type { PlayerSmsResponse, PlayerSmsText } from "../api/audience/player-sms/route";
import type { PlayerCall, PlayerCallsResponse } from "../api/audience/player-calls/route";

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

export const DEPOSITED_OPTIONS: { value: Deposited; label: string }[] = [
  { value: "any", label: "Any" },
  { value: "after", label: "After contact" },
  { value: "before", label: "Before contact only" },
  { value: "none", label: "None on record" },
  { value: "unknown", label: "No CRM record" },
];
export const CONTACT_OPTIONS: { value: Contact; label: string }[] = [
  { value: "any", label: "Any" },
  // "Spoke with them" is the strict rule and sits above the older "Reached", which counts a line
  // that answered in silence and a player who hung up in seconds (VOZ-511, Maria 27 Aug).
  { value: "spoke", label: "Spoke with them" },
  { value: "never_spoke", label: "Never spoke with them" },
  { value: "reached", label: "Reached (answered, spoken to or not)" },
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

// Dates read as words, UTC (Jasiel 2026-09-11: "instead of saying 07-29 let's say AUG 29"). The
// mockup's numeric mm-dd made a reader parse which half was the month, and it read as a US date to
// half the team. Day-then-month is the order the rest of the tab already uses ("3 Sep → 10 Sep" on
// the Reach card and the hero), so the whole page speaks one dialect.
const p2 = (n: number) => String(n).padStart(2, "0");
const MONTHS3 = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** A single-digit day or hour padded to two columns with a NON-BREAKING space, so a column of
 *  stamps lines up instead of fraying ("1 Aug · 2:38 am" beside "29 Jul · 9:16 pm" put the dots and
 *  the times in different places, Jasiel 2026-09-11). A plain leading space collapses in HTML and
 *  a leading ZERO would read as a 24-hour clock, which is the thing we just moved away from; nbsp
 *  is exactly one character wide in the monospace these columns already use. */
const padL = (n: number) => (n < 10 ? ` ${n}` : String(n));
const mmdd = (iso: string | null) => {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : `${padL(d.getUTCDate())} ${MONTHS3[d.getUTCMonth()]}`;
};
/** 12-hour UTC clock (Jasiel 2026-09-11: "pls 12hr format"). Midnight reads 12:00 am and noon
 *  12:00 pm; a bare 0 or a bare 12 would be ambiguous in one direction or the other. Lower-case
 *  am/pm so the meridiem never competes with the figure beside it. */
const clock12 = (d: Date) => {
  const h = d.getUTCHours();
  return `${padL(h % 12 === 0 ? 12 : h % 12)}:${p2(d.getUTCMinutes())} ${h < 12 ? "am" : "pm"}`;
};
const mmddhm = (iso: string | null) => {
  if (!iso) return "—";
  const d = new Date(iso);
  // A middle dot between the date and the clock (Jasiel 2026-09-11): "29 Jul 9:16 pm" ran the two
  // together, and with a 12-hour clock the eye has to find where one ends and the other starts.
  return Number.isNaN(d.getTime()) ? "—" : `${mmdd(iso)} · ${clock12(d)}`;
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
        no record <Info text="No Customer.io record for this player, so this cannot be answered. Not a zero." />
      </td>
    );
  }
  return <td className="px-3 py-2 text-right text-[var(--text-4)]">—</td>;
}

export default function AudiencePlayers({ data, page, onPage, loading, showMarket, marketLabel, brandLabel, filters, onFilters, familyOptions, searching, onExport, exporting, query, onQuery }: {
  data: AudiencePlayersResponse | null;
  /** Export THIS list with THESE filters as CSV (the page owns the fetch; the button lives here,
   *  beside the filters it obeys, since 2026-09-08). */
  onExport: () => void;
  exporting: boolean;
  /** The raw search box text; the page debounces it into the query. It only ever filtered this
   *  table, so the box lives here beside the other filters (2026-09-08). */
  query: string;
  onQuery: (v: string) => void;
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
  const head = (label: string, k: PlayerSort, right = false, first = false, title?: string) => <SortHead label={label} k={k} sort={filters.sort} dir={filters.dir} onSort={sortBy} right={right} first={first} title={title} />;

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
  const pageDeps = withDep.flatMap((r) => r.deposits.filter((d) => d.afterContact));
  const totals = sums(pageDeps);
  const totalsText = totals.length ? " · " + totals.map(([c, n]) => money(c, n)).join(" + ") : "";
  // One EUR figure beside the per-currency sums (Jasiel 2026-09-10: the footer left the reader to
  // convert three currencies by hand). The CRM's own normalisation at deposit time, the same basis
  // as the strip's "EUR … normalised", so the two never disagree on the rate. Every deposit_made row
  // carries it today (0 of 13,192 null); if one ever did not, the count says so rather than letting
  // the total quietly understate.
  const pageEur = pageDeps.reduce((a, d) => a + (d.amountEur ?? 0), 0);
  const pageEurMissing = pageDeps.filter((d) => d.amountLocal != null && d.amountEur == null).length;
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
              <Info text="Players who deposited after the first call or text, newest first. Order, not cause: contacted and never-reached players deposit at the same rate." />
            </span>
          )}
          <div className="flex items-center gap-2 flex-wrap ml-1" aria-label="Player filters">
            <StyledSelect size="sm" prefix="Deposited:" options={DEPOSITED_OPTIONS} value={filters.deposited} onChange={(v) => set({ deposited: v as Deposited })} placeholder="Any" />
            <StyledSelect size="sm" prefix="Contact:" options={CONTACT_OPTIONS} value={filters.contact} onChange={(v) => set({ contact: v as Contact })} placeholder="Any" />
            <Info text="Spoke with them: a person answered and said something. Reached is the older, looser count: it also includes a line that picked up in silence and a player who hung up in the first few seconds." />
            <StyledSelect size="sm" prefix="Family:" options={[{ value: "", label: "All" }, ...familyOptions]} value={filters.family} onChange={(v) => set({ family: v })} placeholder="All" />
          </div>
          <div className="ml-auto flex items-center gap-2.5">
            <label className="relative">
              <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-4)] pointer-events-none" />
              <input
                type="search"
                value={query}
                onChange={(e) => onQuery(e.target.value)}
                placeholder="Phone or name"
                aria-label="Search players"
                className="pl-[26px] pr-6 py-1 w-[170px] text-[12px] rounded-md bg-[var(--bg-elevated)] border border-[var(--border)] text-[var(--text-1)] placeholder:text-[var(--text-4)] focus:outline-none focus:border-primary transition"
              />
              {query && (
                <button type="button" aria-label="Clear the search" onClick={() => onQuery("")} className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[var(--text-3)] hover:text-[var(--text-1)]">
                  <X size={12} />
                </button>
              )}
            </label>
            <span className="font-mono text-[11px] text-[var(--text-4)]" aria-label="Players shown">{loading && !data ? "" : total.toLocaleString("en-US")}</span>
            <button
              type="button"
              onClick={onExport}
              disabled={exporting || !data || total === 0}
              aria-label="Export players"
              title={data ? `Export all ${total.toLocaleString("en-US")} players in this list, not just this page. Opens in Excel.` : "Loading…"}
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
                    {head("First deposit after contact", "first_deposit", true, false, "The first deposit made at or after the first call or text. Sort by it.")}
                    {head("Days to deposit", "lag", true, false, "Days from the first contact to the first deposit after it. Sort by it.")}
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
                      {" "}<Info text="Deposits made after the first call or text. Earlier ones are greyed out and not counted. A dash means none on record." />
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
                        {!onlyDep && r.alsoIn.length > 0 && <> · <span className="text-primary" title={`also in ${r.alsoIn.join(", ")}`}>also in {r.alsoIn.join(", ")}</span></>}
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
            {totals.length > 0 && (
              <>
                {" · "}
                <span
                  aria-label="EUR total for this page"
                  title={`The CRM's EUR conversion of the amounts on this line, at deposit time, added across currencies. Same basis as the strip above. All time after contact for the players on this page, not just this window.${pageEurMissing ? ` ${pageEurMissing} deposit${pageEurMissing === 1 ? "" : "s"} carry no conversion and are left out.` : ""}`}
                >
                  EUR {Math.round(pageEur).toLocaleString("en-US")} normalised{pageEurMissing ? ` (${pageEurMissing} not converted)` : ""}
                </span>
              </>
            )}
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
const hhmm = (iso: string) => clock12(new Date(iso));
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

// The centred popup both message lists share (the dashboard's recordings-popup chrome). One shell,
// two lists: Customer.io's messages and the texts we sent through Mobivate.
function PopupShell({ label, icon, title, meta, subtitle, onExport, exportLabel, onClose, children }: {
  label: string; icon: ReactNode; title: string; meta: string; subtitle: string;
  onExport: () => void; exportLabel: string; onClose: () => void; children: ReactNode;
}) {
  useEffect(() => {
    // The players list closes the DRAWER on Escape from a window listener; document listeners run
    // first in the bubble, so stopping here makes Escape close only this popup. Second Escape, drawer.
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } };
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60" onClick={onClose}>
      <div role="dialog" aria-label={label} className="bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl shadow-2xl w-full max-w-3xl max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-4 px-5 py-4 border-b border-[var(--border)]">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-[var(--text-1)]">
              {icon}
              <span className="font-semibold">{title}</span>
              <span className="font-mono text-[11.5px] text-[var(--text-3)]">{meta}</span>
            </div>
            <p className="text-[11px] text-[var(--text-3)] mt-1">{subtitle}</p>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <button type="button" onClick={onExport} aria-label={exportLabel} title="One row per message. Opens in Excel."
              className="inline-flex items-center gap-1.5 text-[11px] px-2.5 py-1 rounded-md border border-[var(--border)] text-[var(--text-2)] hover:text-[var(--text-1)] hover:border-[var(--border-2)] transition-colors">
              <Download size={12} /> Export CSV
            </button>
            <button type="button" onClick={onClose} aria-label="Close" className="text-[var(--text-3)] hover:text-[var(--text-1)] transition-colors"><X size={18} /></button>
          </div>
        </div>
        <div className="px-5 py-3 overflow-y-auto" aria-label={`${label} list`}>{children}</div>
      </div>
    </div>
  );
}

/** Newest first, grouped by UTC day like the journey. */
function groupByDay<T>(items: T[], at: (x: T) => string | null): { day: string; items: T[] }[] {
  const days: { day: string; items: T[] }[] = [];
  for (const m of [...items].sort((p, q) => ((at(p) ?? "") < (at(q) ?? "") ? 1 : -1))) {
    const key = (at(m) ?? "").slice(0, 10);
    const last = days[days.length - 1];
    if (last && last.day === key) last.items.push(m); else days.push({ day: key, items: [m] });
  }
  return days;
}
const DayHead = ({ day }: { day: string }) => (
  <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-4)] py-1">{day ? dayLabel(`${day}T00:00:00Z`) : "Undated"}</div>
);
const downloadCsv = (head: string[], rows: (string | number | null | undefined)[][], name: string) => {
  const csv = CSV_BOM + [head, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n");
  triggerDownload(new Blob([csv], { type: "text/csv;charset=utf-8;" }), name);
};

function CrmMessagesModal({ messages, pulledAt, phone, onClose }: { messages: CrmMsg[]; pulledAt: string | null; phone: string; onClose: () => void }) {
  // Per-player export (Jasiel 2026-09-08: "can those data be extracted too?"): the same rows the
  // popup shows, one line per message, every timestamp as a column so a spreadsheet can pivot by
  // subject. Client-side from the data already in hand; the shared csvCell guards quoting and
  // formula injection, the BOM keeps Excel's encoding detection honest.
  const exportCsv = () => downloadCsv(
    ["day_utc", "time_utc", "type", "subject", "created_at", "sent_at", "delivered_at", "opened_at", "clicked_at", "failed_at", "interaction"],
    messages.map((m) => [
      (m.createdAt ?? "").slice(0, 10), m.createdAt ? hhmm(m.createdAt) : "", CRM_TYPE[m.type] ?? m.type, m.name,
      m.createdAt, m.sentAt, m.deliveredAt, m.openedAt, m.clickedAt, m.failedAt,
      m.failedAt ? "failed" : m.clickedAt ? "clicked" : m.openedAt ? "opened" : "",
    ]),
    `crm-messages_${phone.replace(/\D/g, "")}_${new Date().toISOString().slice(0, 10)}.csv`,
  );
  const opened = messages.filter((m) => m.openedAt).length;
  const clicked = messages.filter((m) => m.clickedAt).length;
  const byType = [...messages.reduce((acc, m) => acc.set(m.type, (acc.get(m.type) ?? 0) + 1), new Map<string, number>())]
    .sort((a, b) => b[1] - a[1]).map(([t, n]) => `${n} ${CRM_TYPE[t] ?? t}`).join(" · ");
  const days = groupByDay(messages, (m) => m.createdAt);
  return (
    <PopupShell label="CRM messages" icon={<Mail size={15} className="shrink-0" />}
      title={`${messages.length.toLocaleString("en-US")} CRM messages`} meta={`· ${opened} opened · ${clicked} clicked`}
      subtitle={`${byType ? `${byType}. ` : ""}${pulledAt ? `Read at ${hhmm(pulledAt)} UTC.` : ""}`}
      onExport={exportCsv} exportLabel="Export CRM messages as CSV" onClose={onClose}>
      <>
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
      </>
    </PopupShell>
  );
}

// ── the texts WE sent, through Mobivate (Jasiel 2026-09-08: "how about the messages we sent? that's
// important too"). Our own rows: the body, the sender, the receipt, the failure reason, and price/parts
// once the nightly Mobivate reconcile has filled them. "sent, not confirmed" is the honest word for a
// text with no receipt: Mobivate sends none when it refuses a text at the door.
const SMS_STATE: Record<string, { word: string; hot: boolean; bad: boolean }> = {
  delivered: { word: "delivered", hot: true, bad: false },
  sent: { word: "sent, not confirmed", hot: false, bad: false },
  queued: { word: "queued", hot: false, bad: false },
  undelivered: { word: "undelivered", hot: false, bad: true },
  failed: { word: "failed", hot: false, bad: true },
};
const smsState = (t: PlayerSmsText) => SMS_STATE[t.status] ?? { word: t.status.replace(/_/g, " "), hot: false, bad: false };
const money4 = (n: number) => `EUR ${n.toFixed(3).replace(/0$/, "")}`;

function SmsMessagesModal({ texts, pulledAt, phone, onClose }: { texts: PlayerSmsText[]; pulledAt: string | null; phone: string; onClose: () => void }) {
  const delivered = texts.filter((t) => t.status === "delivered").length;
  const exportCsv = () => downloadCsv(
    ["day_utc", "time_utc", "sender", "campaign", "body", "status", "state", "error", "sent_at", "updated_at", "price_eur", "parts"],
    texts.map((t) => [(t.at ?? "").slice(0, 10), hhmm(t.at), t.sender, t.campaign, t.body, t.status, smsState(t).word, t.error, t.at, t.updatedAt, t.priceEur, t.parts]),
    `texts-we-sent_${phone.replace(/\D/g, "")}_${new Date().toISOString().slice(0, 10)}.csv`,
  );
  const spent = texts.reduce((a, t) => a + (t.priceEur ?? 0), 0);
  const priced = texts.filter((t) => t.priceEur != null).length;
  const days = groupByDay(texts, (t) => t.at);
  return (
    <PopupShell label="Texts sent" icon={<MessageSquare size={15} className="shrink-0" />}
      title={`${texts.length} ${texts.length === 1 ? "text" : "texts"} sent`} meta={`· ${delivered} delivered${priced ? ` · ${money4(spent)}` : ""}`}
      subtitle={pulledAt ? `Read at ${hhmm(pulledAt)} UTC.` : ""}
      onExport={exportCsv} exportLabel="Export texts as CSV" onClose={onClose}>
      {days.map(({ day, items }) => (
        <section key={day || "undated"} className="mb-3">
          <DayHead day={day} />
          {items.map((t) => {
            const st = smsState(t);
            return (
              <div key={t.id} role="row" className={`grid grid-cols-[62px_1fr_auto] items-start gap-x-3 py-[7px] border-t border-[var(--border)] text-[12px] ${st.hot ? "" : "text-[var(--text-3)]"}`}>
                <span className="font-mono text-[10.5px] text-[var(--text-4)] pt-px">{hhmm(t.at)}</span>
                <span className="min-w-0">
                  <span className="flex items-center gap-2 mb-[3px]">
                    {t.sender && <span className="text-[10px] px-[6px] py-px rounded-full border border-[var(--border-2)] text-[var(--text-4)] whitespace-nowrap">{t.sender}</span>}
                    <span className="text-[10.5px] text-[var(--text-4)] truncate" title={t.campaign || undefined}>{t.campaign}</span>
                  </span>
                  <span className={`block leading-snug ${st.hot ? "text-[var(--text-1)]" : ""}`}>{t.body}</span>
                </span>
                <span className="flex flex-col items-end gap-1 whitespace-nowrap pt-px">
                  <span aria-label={st.word} title={t.error ?? undefined}
                    className={`text-[10px] px-[7px] py-px rounded-full border ${st.hot || st.bad ? "" : "border-[var(--border-2)] text-[var(--text-4)]"}`}
                    style={st.hot ? { color: ROW_COLOR.reached, borderColor: ROW_COLOR.reached } : st.bad ? { color: ROW_COLOR.declined, borderColor: ROW_COLOR.declined } : undefined}>
                    {st.word}{st.hot && t.updatedAt ? ` ${hhmm(t.updatedAt)}` : ""}
                  </span>
                  {(t.priceEur != null || t.parts != null) && (
                    <span className="font-mono text-[10px] text-[var(--text-4)]">{[t.priceEur != null ? money4(t.priceEur) : null, t.parts != null ? `${t.parts} ${t.parts === 1 ? "part" : "parts"}` : null].filter(Boolean).join(" · ")}</span>
                  )}
                </span>
              </div>
            );
          })}
        </section>
      ))}
    </PopupShell>
  );
}

// ── Calls, every one of them (Jasiel 2026-09-11: "make the calls clickable too pls? so that we
// can track which campaign they're in and whatnot") ──
// Read lazily by /api/audience/player-calls when the popup opens, never on page load. The row's
// count and the journey's six-call tail are not enough to list from: measured across the lane,
// 14.9% of players have more than six calls (max 55), and a truncated list read as complete is
// exactly the VOZ-482 defect.
const CALL_TAG_WORDS: Record<string, string> = {
  positive: "spoke, goal reached",
  neutral: "spoke",
  declined: "declined the offer",
  early_hangup: "hung up early",
  silent_pickup: "answered, nobody spoke",
  agent_timeout: "agent timed out",
  voicemail: "voicemail",
  unreachable: "never connected",
};
const CALL_TAG_TONE: Record<string, "good" | "bad" | "flat"> = {
  positive: "good", neutral: "good", declined: "bad", early_hangup: "bad",
  silent_pickup: "flat", agent_timeout: "flat", voicemail: "flat", unreachable: "bad",
};

function CallsModal({ calls, pulledAt, truncated, phone, onClose }: {
  calls: PlayerCall[]; pulledAt: string | null; truncated: boolean; phone: string; onClose: () => void;
}) {
  const connected = calls.filter((c) => c.status === "completed" || c.status === "answered").length;
  const talk = calls.reduce((a, c) => a + (c.durationSeconds ?? 0), 0);
  // One row per call, the same fields the list shows, so a spreadsheet can pivot by campaign.
  const exportCsv = () => downloadCsv(
    ["day_utc", "time_utc", "campaign", "outcome", "status", "duration_seconds", "ended_reason", "goal_reached", "voicemail", "at"],
    calls.map((c) => [(c.at ?? "").slice(0, 10), hhmm(c.at), c.campaign, CALL_TAG_WORDS[c.tag] ?? c.tag, c.status, c.durationSeconds, c.endedReason, c.goalReached ? "yes" : "no", c.voicemail ? "yes" : "no", c.at]),
    `calls_${phone.replace(/\D/g, "")}_${new Date().toISOString().slice(0, 10)}.csv`,
  );
  const days = groupByDay(calls, (c) => c.at);
  return (
    <PopupShell label="Calls" icon={<PhoneCall size={15} className="shrink-0" />}
      title={`${calls.length} ${calls.length === 1 ? "call" : "calls"}`}
      meta={`· ${connected} connected${talk ? ` · ${secs(talk)} talking` : ""}`}
      subtitle={`${truncated ? "The newest 200 only. " : ""}${pulledAt ? `Read at ${hhmm(pulledAt)} UTC.` : ""}`}
      onExport={exportCsv} exportLabel="Export calls as CSV" onClose={onClose}>
      {days.map(({ day, items }) => (
        <section key={day || "undated"} className="mb-3">
          <DayHead day={day} />
          {items.map((c) => {
            const tone = CALL_TAG_TONE[c.tag] ?? "flat";
            const colour = tone === "good" ? ROW_COLOR.reached : tone === "bad" ? ROW_COLOR.declined : undefined;
            return (
              <div key={c.id} role="row" className="grid grid-cols-[62px_1fr_auto] items-start gap-x-3 py-[7px] border-t border-[var(--border)] text-[12px]">
                <span className="font-mono text-[10.5px] text-[var(--text-4)] pt-px">{hhmm(c.at)}</span>
                <span className="min-w-0">
                  <span className="block text-[10.5px] text-[var(--text-4)] truncate" title={c.campaign || undefined}>{c.campaign || "—"}</span>
                  <span className="block leading-snug text-[var(--text-1)]">
                    {CALL_TAG_WORDS[c.tag] ?? c.tag}
                    {c.durationSeconds ? <span className="text-[var(--text-3)]"> · {secs(c.durationSeconds)}</span> : null}
                  </span>
                </span>
                <span className="flex flex-col items-end gap-1 whitespace-nowrap pt-px">
                  <span aria-label={c.tag} title={c.endedReason ?? undefined}
                    className={`text-[10px] px-[7px] py-px rounded-full border ${colour ? "" : "border-[var(--border-2)] text-[var(--text-4)]"}`}
                    style={colour ? { color: colour, borderColor: colour } : undefined}>
                    {c.status}
                  </span>
                </span>
              </div>
            );
          })}
        </section>
      ))}
    </PopupShell>
  );
}

// ── Deposits, every one we hold (Jasiel 2026-09-11: "is there a way we can also show their
// lifetime deposits? ... same mechanism on SMS and CRM messages, underlined, if clicked shows
// summary") ──
// No route: the players row already carries the player's FULL deposit list (only the journey
// timeline is capped, at four). So this popup is pure rendering of data already in hand.
//
// "Lifetime" is the word to be careful with. cio_events holds a one-off capture from 26 Jul to
// 25 Aug and the live webhook from 2 Sep, with 26 Aug to 1 Sep in NEITHER. So the total below is
// every deposit WE HOLD, not the player's history with the brand, and the label and hover say so.
function DepositsModal({ deposits, phone, onClose }: { deposits: PlayerDeposit[]; phone: string; onClose: () => void }) {
  const after = deposits.filter((d) => d.afterContact);
  const exportCsv = () => downloadCsv(
    ["day_utc", "time_utc", "currency", "amount_local", "amount_eur", "after_contact", "at"],
    deposits.map((d) => [(d.at ?? "").slice(0, 10), hhmm(d.at), d.currency, d.amountLocal, d.amountEur, d.afterContact ? "yes" : "no", d.at]),
    `deposits_${phone.replace(/\D/g, "")}_${new Date().toISOString().slice(0, 10)}.csv`,
  );
  const days = groupByDay(deposits, (d) => d.at);
  const line = (list: PlayerDeposit[]) => (sums(list).length ? sums(list).map(([c, n]) => money(c, n)).join(" + ") : "none");
  return (
    <PopupShell label="Deposits" icon={<Wallet size={15} className="shrink-0" />}
      title={`${deposits.length} ${deposits.length === 1 ? "deposit" : "deposits"}`}
      meta={`· ${after.length} after contact`}
      subtitle="Every deposit on record for this player. Our records run from 26 Jul, with a gap from 26 Aug to 1 Sep, so this is not their whole history with the brand."
      onExport={exportCsv} exportLabel="Export deposits as CSV" onClose={onClose}>
      <div className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 pb-2.5 mb-1 border-b border-[var(--border)] text-[12px]">
        <span className="text-[var(--text-3)]">After contact</span>
        <span className="font-mono text-right text-[var(--text-1)]">{line(after)}</span>
        <span className="text-[var(--text-3)]">Total on record</span>
        <span className="font-mono text-right text-[var(--text-1)]">{line(deposits)}</span>
      </div>
      {days.map(({ day, items }) => (
        <section key={day || "undated"} className="mb-3">
          <DayHead day={day} />
          {items.map((d, i) => (
            <div key={`${d.at}-${i}`} role="row" className="grid grid-cols-[62px_1fr_auto] items-center gap-x-3 py-[7px] border-t border-[var(--border)] text-[12px]">
              <span className="font-mono text-[10.5px] text-[var(--text-4)]">{hhmm(d.at)}</span>
              <span className={`text-[10.5px] ${d.afterContact ? "text-[var(--text-3)]" : "text-[var(--text-4)]"}`}>
                {d.afterContact ? "after contact" : "before contact, not counted"}
              </span>
              <span className={`font-mono text-right ${d.afterContact ? "text-[var(--text-1)]" : "text-[var(--text-4)]"}`}>
                {d.amountLocal == null ? "—" : money(d.currency ?? "?", d.amountLocal)}
              </span>
            </div>
          ))}
        </section>
      ))}
    </PopupShell>
  );
}
type CallsState = { status: "loading" } | { status: "ready"; data: PlayerCallsResponse } | { status: "error" };

type SmsState = { status: "loading" } | { status: "ready"; data: PlayerSmsResponse } | { status: "error"; message: string; detail: string };

// Why no text went out, in the operator's words (Jasiel 2026-09-08: "we spoke but why didn't we
// send SMS?"). The reason is decideSmsDispatch's own word for the player's latest call, replayed by
// the player-sms route; the words are the drawer's attempt vocabulary.
const SMS_WHY_WORDS: Record<string, string> = {
  early_hangup: "hung up early",
  voicemail: "voicemail",
  voicemail_redial_first: "voicemail",
  silent_pickup: "answered, no conversation",
  not_reached: "never connected",
  agent_timeout: "agent timed out",
  opted_out_on_call: "asked not to be contacted",
  customer_declined_sms: "declined a text",
  no_human_conversation: "no conversation",
};
const SMS_MODE_WORDS: Record<string, string> = {
  optin_reached_only: "a real conversation",
  optin_any_pickup: "any pickup",
  registered_optin: "a conversation with a registered player",
  verbal_yes: "a spoken yes",
};
const smsWhyLine = (w: PlayerSmsResponse["why"]): { words: string; hint: string } | null => {
  if (!w) return null;
  if (!w.configured) return { words: "no text set on this campaign", hint: "This campaign has SMS off or no message written, so no call could have produced a text." };
  if (w.attempt) return { words: "a text was expected", hint: "The last call qualified for a text under this campaign's rule, but none was sent. Worth a look." };
  const words = SMS_WHY_WORDS[w.reason] ?? w.reason.replace(/_/g, " ");
  return { words, hint: `The last call${w.lastCallAt ? ` on ${mmdd(w.lastCallAt)}` : ""} was read as "${words}". This campaign texts only after ${SMS_MODE_WORDS[w.mode] ?? w.mode}.` };
};

/** The same drawer, opened from a phone number instead of a table row (Jasiel 2026-09-08: the
 *  numbers on a run in Campaign families were not clickable "the same way as the depositors"). It
 *  fetches the player's full row from the players query, scoped like the page and over ALL time so
 *  the window cannot hide them, then renders PlayerDrawer, so calls, texts, deposits, both popups
 *  and their exports come along unchanged. While it loads, the same shell with the number and
 *  placeholders, so the click is answered at once. Escape closes it, like the list's own drawer. */
type ByPhoneState = { status: "loading" } | { status: "ready"; row: AudiencePlayerRow } | { status: "missing" } | { status: "error"; message: string };
export function PlayerDrawerByPhone({ phone, brandLabel, scopeQs, onClose }: { phone: string; brandLabel: string; scopeQs: string; onClose: () => void }) {
  const [state, setState] = useState<ByPhoneState>({ status: "loading" });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  // No reset here: the mount site keys this component on the phone, so a different player is a
  // fresh instance already in its loading state (and React's set-state-in-effect rule stays green).
  useEffect(() => {
    const ctrl = new AbortController();
    const digits = phone.replace(/\D/g, "");
    fetch(`/api/audience/players?${scopeQs ? `${scopeQs}&` : ""}range=lifetime&q=${encodeURIComponent(digits)}&page=1`, { cache: "no-store", signal: ctrl.signal })
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() as Promise<AudiencePlayersResponse>; })
      .then((j) => {
        const row = j.rows.find((x) => x.phone.replace(/\D/g, "") === digits) ?? null;
        setState(row ? { status: "ready", row } : { status: "missing" });
      })
      .catch((e: unknown) => { if (!(e instanceof Error && e.name === "AbortError")) setState({ status: "error", message: e instanceof Error ? e.message : String(e) }); });
    return () => ctrl.abort();
  }, [phone, scopeQs]);
  if (state.status === "ready") return <PlayerDrawer row={state.row} brandLabel={brandLabel} onClose={onClose} />;
  return (
    <>
      <button type="button" aria-label="Close" onClick={onClose} className="fixed inset-0 z-[90] bg-black/50 cursor-default" />
      <aside role="dialog" aria-label="Member detail" aria-busy={state.status === "loading"} className="fixed top-0 right-0 bottom-0 z-[95] w-[392px] max-w-[92vw] bg-[var(--bg-card)] border-l border-[var(--border)] shadow-2xl flex flex-col">
        <div className="flex items-start gap-2.5 px-[17px] py-[15px] border-b border-[var(--border)]">
          <div className="min-w-0 flex-1">
            <div className="font-mono text-[14px] text-[var(--text-1)]">{phone}</div>
            <div className="text-[11px] text-[var(--text-4)] mt-[3px]">
              {state.status === "loading" ? <Pulse w="w-40" /> : state.status === "missing" ? "No player record for this number in this scope." : `Did not load: ${state.message}`}
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="text-[var(--text-3)] hover:text-[var(--text-1)]"><X size={16} /></button>
        </div>
        {state.status === "loading" && (
          <div className="px-[17px] py-[13px] grid grid-cols-[1fr_auto] gap-y-2 text-[12px]">
            {["Calls", "SMS", "Deposited after contact", "CRM messages"].map((l) => (
              <div key={l} className="contents"><span className="text-[var(--text-3)]">{l}</span><Pulse w="w-16" /></div>
            ))}
          </div>
        )}
      </aside>
    </>
  );
}

/** The drawer's sub line: brand, this player's family, and any other family they sit in. Built once
 *  so the visible (truncated) line and its hover title cannot drift apart. */
const SUB_LINE = (brand: string, r: AudiencePlayerRow) =>
  [brand, r.campaignLabel, r.alsoIn.length ? `also in ${r.alsoIn.join(", ")}` : ""].filter(Boolean).join(" · ");

function PlayerDrawer({ row: open, brandLabel, onClose }: { row: AudiencePlayerRow; brandLabel: string; onClose: () => void }) {
  const [crm, setCrm] = useState<CrmState>(open.cio.length ? { status: "loading" } : { status: "none" });
  const [crmOpen, setCrmOpen] = useState(false);
  const [sms, setSms] = useState<SmsState>({ status: "loading" });
  const [smsOpen, setSmsOpen] = useState(false);
  const [calls, setCalls] = useState<CallsState>({ status: "loading" });
  const [callsOpen, setCallsOpen] = useState(false);
  const [depOpen, setDepOpen] = useState(false);
  useEffect(() => {
    const ctrl = new AbortController();
    fetch(`/api/audience/player-sms?phone=${encodeURIComponent(open.phone)}`, { cache: "no-store", signal: ctrl.signal })
      .then(async (r) => {
        if (!r.ok) { const b = (await r.json().catch(() => null)) as { error?: unknown } | null; throw new Error(b?.error ? String(b.error) : `HTTP ${r.status}`); }
        return r.json() as Promise<PlayerSmsResponse>;
      })
      .then((d) => setSms({ status: "ready", data: d }))
      .catch((e: unknown) => { if (!(e instanceof Error && e.name === "AbortError")) setSms({ status: "error", message: "Text records did not load", detail: e instanceof Error ? e.message : String(e) }); });
    return () => ctrl.abort();
  }, [open.phone]);
  useEffect(() => {
    // Lazy, like the texts above: every call for this phone, read when the drawer opens. The row
    // carries a count and the journey a six-call tail, and 14.9% of players have more than six.
    const ctrl = new AbortController();
    fetch(`/api/audience/player-calls?phone=${encodeURIComponent(open.phone)}`, { cache: "no-store", signal: ctrl.signal })
      .then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.json() as Promise<PlayerCallsResponse>; })
      .then((d) => setCalls({ status: "ready", data: d }))
      .catch((e: unknown) => { if (!(e instanceof Error && e.name === "AbortError")) setCalls({ status: "error" }); });
    return () => ctrl.abort();
  }, [open.phone]);
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
              const err: CrmFetchError = new Error(r.status === 503 ? "Customer.io is not connected for this brand" : "Customer.io did not answer");
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
        setCrm({ status: "error", message: e instanceof Error ? e.message : "Customer.io did not answer", detail: err?.detail ?? (e instanceof Error ? e.message : String(e)) });
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

  // Export the journey (Jasiel 2026-09-10). NOT the 30-entry timeline above, which is a display cut:
  // this takes the FULL lists the drawer holds — every deposit, every text once the texts have
  // loaded, every CRM message and event once Customer.io has answered. Calls are the exception: the
  // route sends the last 6 (the drawer timelines keep only a tail, 03 Sep lesson), so the file says
  // so in a final note row rather than passing a tail off as a history. Client-side, same helpers.
  const textsLoaded = sms.status === "ready";
  const crmLoaded = crm.status === "ready";
  const exportJourney = () => {
    const callEvents = open.events.filter((e) => e.kind === "call");
    const rows: { at: string; source: string; kind: string; detail: string }[] = [
      ...callEvents.map((e) => ({ at: e.at, source: "voizo", kind: "call", detail: callLine(e) })),
      ...(textsLoaded
        ? sms.data.texts.map((t) => ({ at: t.at, source: "voizo", kind: "sms", detail: `We texted · ${t.status}${t.error ? ` · ${t.error}` : ""}` }))
        : open.events.filter((e) => e.kind === "sms").map((e) => ({ at: e.at, source: "voizo", kind: "sms", detail: smsLine(e) }))),
      ...open.deposits.map((d) => ({
        at: d.at, source: "deposit", kind: "deposit",
        detail: `Deposited ${d.currency ?? ""} ${d.amountLocal == null ? "" : d.amountLocal.toFixed(2)}`.trim() + (d.afterContact ? "" : " · before we contacted them"),
      })),
      ...(open.firstAt ? [{ at: open.firstAt, source: "voizo", kind: "first_contact", detail: "First contact" }] : []),
      ...(crmLoaded ? messages.map((m) => ({ at: m.sentAt ?? m.createdAt ?? "", source: "crm", kind: m.type, detail: crmMessageLine(m) })) : []),
      ...(crmLoaded ? crmEvents.map((e) => ({ at: e.at, source: "crm", kind: "event", detail: crmEventLine(e.name) })) : []),
    ].filter((r) => r.at).sort((a, b) => (a.at < b.at ? 1 : -1));
    const note = [
      `calls: the last ${callEvents.length} of ${open.calls} on record`,
      textsLoaded ? `texts: all ${sms.data.texts.length}` : "texts: the last few only, the full list had not loaded",
      `deposits: all ${open.deposits.length}`,
      crmLoaded ? `crm: ${messages.length} messages, ${crmEvents.length} events` : "crm: not loaded",
    ].join("; ");
    downloadCsv(
      ["day_utc", "time_utc", "at_utc", "source", "kind", "detail"],
      [...rows.map((r) => [r.at.slice(0, 10), r.at.slice(11, 19), r.at, r.source, r.kind, r.detail]), ["", "", "", "note", "", note]],
      `audience-journey_${open.phone.replace(/[^\d]/g, "")}.csv`,
    );
  };

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
            <div className="text-[11px] text-[var(--text-4)] mt-[3px] truncate" title={SUB_LINE(brandLabel, open)}>
              {SUB_LINE(brandLabel, open)}
            </div>
            {/* The CRM identity, live: the phone alone does not find a profile in Customer.io. */}
            <div className="text-[11px] mt-[6px] flex flex-col gap-px" aria-label="Customer.io identity">
              {crm.status === "loading" && <span className="text-[var(--text-4)]">Customer.io…</span>}
              {crm.status === "none" && <span className="text-[var(--text-4)]">no Customer.io record</span>}
              {/* Muted like the other neutral states, never amber: nothing on this page is broken, one
                  source is missing. The technical reason sits on hover for whoever debugs it. */}
              {crm.status === "error" && <span className="text-[var(--text-4)]" title={crm.detail}>{crm.message}. Everything else here is fine.</span>}
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
          <button
            type="button"
            onClick={exportJourney}
            disabled={sms.status === "loading" || crm.status === "loading"}
            aria-label="Export this player's journey"
            title={sms.status === "loading" || crm.status === "loading"
              ? "Loading the texts and the Customer.io record first"
              : "Every deposit, every text, the Customer.io messages and events, and the last calls, one row each, oldest at the bottom. The last row says what is complete. Opens in Excel."}
            className="ml-auto inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] font-medium border border-[var(--border)] text-[var(--text-2)] hover:text-[var(--text-1)] hover:border-[var(--border-2)] transition disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
          >
            <Download size={12} /> Export
          </button>
          <button type="button" aria-label="Close" onClick={onClose} className="text-[var(--text-3)] hover:text-[var(--text-1)] shrink-0">
            <X size={15} />
          </button>
        </div>
        <div className="px-[17px] py-[15px] overflow-y-auto">
          <div className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-[7px] mb-5 text-[11.5px]">
            <div className="text-[var(--text-3)]">Calls</div>
            {calls.status === "ready" && calls.data.calls.length ? (
              // The summary opens the full list: every call, its campaign, and how it ended.
              <button type="button" onClick={() => setCallsOpen(true)} aria-label="Calls" aria-haspopup="dialog" title="See every call, its campaign and how it ended"
                className="font-mono text-[12px] text-right text-[var(--text-1)] underline decoration-dotted decoration-[var(--text-4)] underline-offset-[3px] hover:decoration-[var(--text-2)] cursor-pointer justify-self-end">
                {calls.data.calls.length}
              </button>
            ) : (
              <div className="font-mono text-[12px] text-right text-[var(--text-1)]" aria-label="Calls">{open.calls}</div>
            )}
            <div className="text-[var(--text-3)]">SMS</div>
            {sms.status === "ready" && sms.data.texts.length ? (
              // The summary opens the full list: every text we sent, the words, and whether it arrived.
              <button type="button" onClick={() => setSmsOpen(true)} aria-label="Texts sent" aria-haspopup="dialog" title="See each text and whether it arrived"
                className="font-mono text-[12px] text-right text-[var(--text-1)] underline decoration-dotted decoration-[var(--text-4)] underline-offset-[3px] hover:decoration-[var(--text-2)] cursor-pointer justify-self-end">
                {`${sms.data.texts.length} ${sms.data.texts.length === 1 ? "text" : "texts"} · ${sms.data.texts.filter((t) => t.status === "delivered").length} delivered`}
              </button>
            ) : (
              (() => {
                const why = sms.status === "ready" && !sms.data.texts.length ? smsWhyLine(sms.data.why) : null;
                return (
                  <div className="font-mono text-[12px] text-right text-[var(--text-1)]" aria-label="Texts sent" title={sms.status === "error" ? sms.detail : why?.hint}>
                    {open.smsDelivered ? `${open.smsDelivered} delivered` : open.smsSent ? "sent, not confirmed" : why ? <>none <span className="text-[var(--text-4)]">· {why.words}</span></> : "none"}
                  </div>
                );
              })()
            )}
            <div className="text-[var(--text-3)]">Deposited after contact</div>
            {open.deposits.length ? (
              // The summary opens the full list: every deposit, before and after contact.
              <button type="button" onClick={() => setDepOpen(true)} aria-label="Deposited after contact" aria-haspopup="dialog" title="See every deposit on record for this player"
                className={`font-mono text-[12px] text-right underline decoration-dotted decoration-[var(--text-4)] underline-offset-[3px] hover:decoration-[var(--text-2)] cursor-pointer justify-self-end ${s === "after" ? "text-[var(--text-1)]" : "text-[var(--text-4)]"}`}>
                {s === "after" ? sums(open.deposits.filter((d) => d.afterContact)).map(([c, n]) => money(c, n)).join(" + ") : "before contact only"}
              </button>
            ) : (
              <div className="font-mono text-[12px] text-right text-[var(--text-4)]" aria-label="Deposited after contact">
                {s === "unknown" ? "no record" : "none"}
              </div>
            )}
            {/* Every deposit we hold, before and after contact (Jasiel 2026-09-11: "is there a way
                we can also show their lifetime deposits?"). It appears ONLY when the player has a
                deposit from before we contacted them, because otherwise it repeats the row above to
                the cent (Jasiel, same day: "it's kind of redundant seeing 2 total"). Not called
                "lifetime": cio_events runs from 26 Jul with a gap from 26 Aug to 1 Sep, so it is
                our record, not their history with the brand. */}
            {open.deposits.some((d) => !d.afterContact) && (
              <>
                <div className="text-[var(--text-3)] flex items-center gap-1">
                  Deposited, total
                  <Info text="Every deposit we hold for this player, before and after Voizo contacted them. Shown only when some of it came before contact. Our deposit records start 26 Jul and have a gap from 26 Aug to 1 Sep, so this is not their whole history with the brand." />
                </div>
                <button type="button" onClick={() => setDepOpen(true)} aria-label="Deposited total" aria-haspopup="dialog" title="See every deposit on record for this player"
                  className="font-mono text-[12px] text-right text-[var(--text-1)] underline decoration-dotted decoration-[var(--text-4)] underline-offset-[3px] hover:decoration-[var(--text-2)] cursor-pointer justify-self-end">
                  {sums(open.deposits).map(([c, n]) => money(c, n)).join(" + ")}
                </button>
              </>
            )}
            <div className="text-[var(--text-3)] flex items-center gap-1">CRM messages <Info text="Emails and in-app messages Customer.io sent this player, read when this panel opened. Opens and clicks count people only, never mail scanners." /></div>
            {crm.status === "ready" && messages.length ? (
              // The summary opens the full list: every message, its subject, and what the player did with it.
              <button type="button" onClick={() => setCrmOpen(true)} aria-label="CRM messages" aria-haspopup="dialog" title="See each message, and which ones they opened"
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
      {callsOpen && calls.status === "ready" && (
        <CallsModal calls={calls.data.calls} pulledAt={calls.data.pulledAt} truncated={calls.data.truncated} phone={open.phone} onClose={() => setCallsOpen(false)} />
      )}
      {depOpen && <DepositsModal deposits={open.deposits} phone={open.phone} onClose={() => setDepOpen(false)} />}
      {smsOpen && sms.status === "ready" && <SmsMessagesModal texts={sms.data.texts} pulledAt={sms.data.pulledAt} phone={open.phone} onClose={() => setSmsOpen(false)} />}
    </>
  );
}
