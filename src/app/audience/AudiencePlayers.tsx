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
import { X } from "lucide-react";
import Pagination from "@/components/Pagination";
import StyledSelect from "@/components/StyledSelect";
import { Info } from "../analytics/ConnectRateHero";
import { ROW_COLOR } from "../analytics/PerformanceCards";
import type { Dot } from "@/lib/audienceLane";
import type { AudiencePlayerRow, AudiencePlayersResponse, Contact, Deposited, PlayerDeposit, PlayerEvent, PlayerSort } from "../api/audience/players/route";
import type { PlayerCrmResponse } from "../api/audience/player-crm/route";

export interface PlayerFilters {
  deposited: Deposited;
  contact: Contact;
  /** A family key from /api/audience/reach; "" = any. */
  family: string;
  sort: PlayerSort;
}
export const DEFAULT_FILTERS: PlayerFilters = { deposited: "any", contact: "any", family: "", sort: "last_contact" };

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
const SORT_OPTIONS: { value: PlayerSort; label: string }[] = [
  { value: "last_contact", label: "Last contact" },
  { value: "last_deposit", label: "Last deposit" },
  { value: "amount", label: "Deposited amount" },
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
// --color-primary is the app's token (globals.css); a bare --primary resolves to nothing and the dot vanishes.
const EVENT_COLOR = { call: ROW_COLOR.reached, sms: ROW_COLOR.neutral, dep: "var(--color-primary)", crm: ROW_COLOR.voicemail, event: ROW_COLOR.silent_pickup } as const;
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
const eventLine = (e: PlayerEvent, firstAt: string | null) =>
  e.kind === "sms"
    ? `SMS ${e.what === "delivered" ? "delivered" : e.what} — offer follow-up`
    : e.kind === "dep"
      ? `Deposit ${e.what}${firstAt && e.at < firstAt ? " · before contact" : ""}`
      : `${e.what.replace(/_/g, " ")}${e.durationSeconds ? ` — ${e.durationSeconds}s` : ""}`;

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

export default function AudiencePlayers({ data, page, onPage, loading, showMarket, marketLabel, brandLabel, filters, onFilters, familyOptions, searching }: {
  data: AudiencePlayersResponse | null;
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
  const empty = loading && !data
    ? "Loading…"
    : onlyDep
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
              contact → money, per player <Info text="Players who deposited after our first call or text to them, inside the window the range control sets, newest deposit first. Proximity is not causation: two independent studies found contacted and never-reached players deposit at the same rate. This view shows WHO touched each depositor and WHEN, so people judge with the evidence in front of them." />
            </span>
          )}
          <div className="flex items-center gap-2 flex-wrap ml-1" aria-label="Player filters">
            <StyledSelect size="sm" prefix="Deposited:" options={DEPOSITED_OPTIONS} value={filters.deposited} onChange={(v) => set({ deposited: v as Deposited })} placeholder="Any" />
            <StyledSelect size="sm" prefix="Contact:" options={CONTACT_OPTIONS} value={filters.contact} onChange={(v) => set({ contact: v as Contact })} placeholder="Any" />
            <StyledSelect size="sm" prefix="Family:" options={[{ value: "", label: "All" }, ...familyOptions]} value={filters.family} onChange={(v) => set({ family: v })} placeholder="All" />
            <StyledSelect size="sm" prefix="Sort:" options={SORT_OPTIONS} value={filters.sort} onChange={(v) => set({ sort: v as PlayerSort })} placeholder="Last contact" />
          </div>
          <span className="ml-auto font-mono text-[11px] text-[var(--text-4)]" aria-label="Players shown">{loading && !data ? "" : total.toLocaleString("en-US")}</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-[12.5px] border-collapse">
            <thead>
              <tr className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-3)]">
                <th className="text-left px-4 py-2 font-semibold">Phone</th>
                {showMarket && th("Market")}
                {th("Campaign")}
                {onlyDep ? (
                  <>
                    {th("Attempt")}
                    {th("First contact", true)}
                    {th("Deposit", true)}
                    {th("Days", true)}
                    <th className="text-right px-4 py-2 font-semibold">Deposited</th>
                  </>
                ) : (
                  <>
                    {th("Last 3 calls →")}
                    <th className="text-right px-3 py-2 font-semibold whitespace-nowrap">
                      Deposited after contact <Info text="Only deposits made after our first call or text to the player, as Customer.io reported them. Earlier deposits are shown greyed and not counted. A dash means no deposit on record; no record means we hold no identity to check." />
                    </th>
                    <th className="text-right px-4 py-2 font-semibold">Last contact</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
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
type CrmState = { status: "loading" } | { status: "none" } | { status: "ready"; data: PlayerCrmResponse[] } | { status: "error"; message: string };

function PlayerDrawer({ row: open, brandLabel, onClose }: { row: AudiencePlayerRow; brandLabel: string; onClose: () => void }) {
  const [crm, setCrm] = useState<CrmState>(open.cio.length ? { status: "loading" } : { status: "none" });
  useEffect(() => {
    if (!open.cio.length) return;
    const ctrl = new AbortController();
    Promise.all(
      open.cio.map((c) =>
        fetch(`/api/audience/player-crm?workspace=${encodeURIComponent(c.workspace)}&cio=${encodeURIComponent(c.cioId)}`, { cache: "no-store", signal: ctrl.signal })
          .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() as Promise<PlayerCrmResponse>; }),
      ),
    )
      .then((all) => setCrm({ status: "ready", data: all }))
      .catch((e: unknown) => { if (!(e instanceof Error && e.name === "AbortError")) setCrm({ status: "error", message: e instanceof Error ? e.message : "Customer.io did not answer" }); });
    return () => ctrl.abort();
  }, [open.cio]);

  const s = depState(open);
  const crmData = crm.status === "ready" ? crm.data : [];
  const profile = crmData.map((d) => d.profile).find((p) => p && (p.name || p.email)) ?? null;
  const messages = crmData.flatMap((d) => d.messages);
  const crmEvents = crmData.flatMap((d) => d.events);
  const opened = messages.filter((m) => m.openedAt).length;
  const clicked = messages.filter((m) => m.clickedAt).length;
  const pulledAt = crmData[0]?.pulledAt ?? null;
  const partial = crmData.some((d) => d.unavailable.messages || d.unavailable.events);
  // The timeline: Voizo's own events, the CRM's messages and events, the first-contact pin, newest first.
  const timeline: { at: string; kind: "call" | "sms" | "dep" | "crm" | "event" | "pin"; text: string }[] = [
    ...open.events.map((e) => ({ at: e.at, kind: e.kind, text: eventLine(e, open.firstAt) })),
    ...(open.firstAt ? [{ at: open.firstAt, kind: "pin" as const, text: "First contact" }] : []),
    ...messages.slice(0, 8).map((m) => ({
      at: m.sentAt ?? m.createdAt ?? "",
      kind: "crm" as const,
      text: `CRM ${m.type}${m.name ? ` · ${m.name}` : ""}${m.failedAt ? " · failed" : m.clickedAt ? " · clicked" : m.openedAt ? " · opened" : m.deliveredAt ? " · delivered" : m.sentAt ? " · sent" : ""}`,
    })),
    ...crmEvents.filter((e) => e.name !== "deposit_made").slice(0, 8).map((e) => ({ at: e.at, kind: "event" as const, text: `CRM event · ${e.name.replace(/_/g, " ")}` })),
  ].filter((e) => e.at).sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, 24);
  const dot = (kind: keyof typeof EVENT_COLOR | "pin") => (kind === "pin"
    ? { background: "var(--bg-card)", border: "1px solid var(--text-3)" }
    : { background: EVENT_COLOR[kind], border: `1px solid ${EVENT_COLOR[kind]}` });

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
              {[brandLabel, open.campaignLabel, open.alsoIn.length ? `also in ${open.alsoIn.join(", ")}` : "", open.name ?? ""].filter(Boolean).join(" · ")}
            </div>
            {/* The CRM identity, live: the phone alone does not find a profile in Customer.io. */}
            <div className="text-[11px] mt-[5px] flex flex-col gap-px" aria-label="Customer.io identity">
              {crm.status === "loading" && <span className="text-[var(--text-4)]">Customer.io…</span>}
              {crm.status === "none" && <span className="text-[var(--text-4)]">no Customer.io record</span>}
              {crm.status === "error" && <span className="text-amber-400 font-mono">Customer.io not pulled: {crm.message}</span>}
              {crm.status === "ready" && (
                <>
                  {profile?.name && <span className="text-[var(--text-2)]">{profile.name}</span>}
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
          <div className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-[7px] mb-4 text-[11.5px]">
            <div className="text-[var(--text-3)]">Calls</div><div className="font-mono text-[12px] text-right text-[var(--text-1)]">{open.calls}</div>
            <div className="text-[var(--text-3)]">SMS</div>
            <div className="font-mono text-[12px] text-right text-[var(--text-1)]">
              {open.smsDelivered ? `${open.smsDelivered} delivered` : open.smsSent ? "sent, not confirmed" : "none"}
            </div>
            <div className="text-[var(--text-3)]">Deposited after contact</div>
            <div className={`font-mono text-[12px] text-right ${s === "after" ? "text-[var(--text-1)]" : "text-[var(--text-4)]"}`}>
              {s === "unknown" ? "no record" : s === "none" ? "none" : s === "before" ? "before contact only" : sums(open.deposits.filter((d) => d.afterContact)).map(([c, n]) => money(c, n)).join(" + ")}
            </div>
            <div className="text-[var(--text-3)] flex items-center gap-1">CRM messages <Info text="Messages Customer.io sent this player (email, in-app, push, SMS, webhook), read live from Customer.io when this drawer opened. Opened and clicked count people only; machine opens by mail scanners never enter a number." /></div>
            <div className={`font-mono text-[12px] text-right ${crm.status === "ready" ? "text-[var(--text-1)]" : "text-[var(--text-4)]"}`} aria-label="CRM messages">
              {crm.status === "ready" ? (messages.length ? `${messages.length} · ${opened} opened · ${clicked} clicked` : partial ? "not pulled" : "none") : crm.status === "none" ? "no record" : crm.status === "error" ? "not pulled" : "…"}
            </div>
          </div>
          <div className="border-l border-[var(--border)] pl-4 ml-1 flex flex-col gap-3">
            {timeline.map((e, i) => (
              <div key={i} className="relative">
                <span className="absolute -left-5 top-1 w-[7px] h-[7px] rounded-full" style={dot(e.kind)} />
                <div className="font-mono text-[10.5px] text-[var(--text-4)]">{mmddhm(e.at)}</div>
                <div className="text-[12px] text-[var(--text-2)] mt-0.5">{e.kind === "pin" ? <b className="font-medium text-[var(--text-1)]">First contact</b> : e.text}</div>
              </div>
            ))}
          </div>
          <div className="flex gap-3 flex-wrap mt-3.5 text-[10.5px] text-[var(--text-4)]">
            <span className="inline-flex items-center gap-[5px]"><i className="inline-block w-[7px] h-[7px] rounded-full" style={{ background: EVENT_COLOR.call }} />Call</span>
            <span className="inline-flex items-center gap-[5px]"><i className="inline-block w-[7px] h-[7px] rounded-full" style={{ background: EVENT_COLOR.sms }} />Text</span>
            <span className="inline-flex items-center gap-[5px]"><i className="inline-block w-[7px] h-[7px] rounded-full" style={{ background: EVENT_COLOR.dep }} />Deposit</span>
            <span className="inline-flex items-center gap-[5px]"><i className="inline-block w-[7px] h-[7px] rounded-full" style={{ background: EVENT_COLOR.crm }} />CRM message</span>
            <span className="inline-flex items-center gap-[5px]"><i className="inline-block w-[7px] h-[7px] rounded-full" style={{ background: EVENT_COLOR.event }} />CRM event</span>
            <span className="inline-flex items-center gap-[5px]"><i className="inline-block w-[7px] h-[7px] rounded-full border border-[var(--text-3)]" />First contact</span>
          </div>
          <p className="mt-[15px] text-[11px] text-[var(--text-4)] leading-relaxed">
            Calls and texts are live from our own records. Deposits are what Customer.io has sent us: the one-off pull of 25 Aug and the live feed since 2 Sep.
            {crm.status === "ready" && pulledAt ? ` CRM messages, events and identity were read from Customer.io at ${mmddhm(pulledAt)} UTC; events cover its rolling 30-day window.` : ""}
          </p>
        </div>
      </aside>
    </>
  );
}
