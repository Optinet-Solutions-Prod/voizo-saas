"use client";

// src/app/audience/page.tsx
//
// Audience — the real tab, ported from the canonical mockup (2026-08-25 v4, VOZ-457) which until
// now shipped only as the frozen snapshot at /audience/preview. Laid out in the mockup's order
// (`render()`): the top row is the title and the market tabs; the toolbar below
// is the DASHBOARD's range control (Jasiel 2026-09-07: "re-use this"): Export, the presets 7d to 90d
// and All, and the Pick-a-window calendar, the same control Campaign Performance carries. Then the
// connect-rate hero with the Members tile flush at its top, Deposits by day, Reach, the player list,
// and the campaign families last (Jasiel 2026-09-07). The Lead Recycling page that used to live here
// moved to /audience/lead-recycling, unlinked (its `local_segments` table has never held a row).
//
// WHAT IS DELIBERATELY NOT HERE, so nothing on this page is a stale number dressed as a live one:
//   - The two deposit-lift tiles: the frozen 25 Aug study, not recomputable until live deposits
//     cover a real window (Jasiel 2026-09-07: leave them off).
//   - The count on each market tab: the mockup carried one; the tabs stay words until the lane
//     counts have been reconciled.
//
// Connect rate is the DASHBOARD's definition (status completed/answered), not the mockup's
// stricter "clean hangup with talk time". Measured over the last 7 days they differ by 19 calls
// of 4,841 (85.1% vs 84.7%), all clean hangups at zero seconds. One definition across both tabs
// beats two that disagree on the same lane by a rounding error.
//
// Data: /api/dashboard/analytics (hero), /api/audience/reach (Members, Reach, Deposits by day,
// families) and /api/audience/players (the filtered, paged player query), all scoped by the sidebar
// brand, the market tab and the window. Read-only, no provider spend, nothing near the call or SMS path.

import { useCallback, useEffect, useRef, useState } from "react";
import { loadSnapshot, saveSnapshot } from "@/lib/sessionSnapshot";
import { useBrandScope } from "@/lib/brandScope";
import { brandLabel } from "@/lib/campaignDisplay";
import type { TrendPoint } from "@/lib/dashboardAnalytics";
import type { DayCount } from "@/lib/connectRateHero";
import type { RangeKey } from "@/lib/rangeWindow";
import { addDays } from "@/lib/rangeCalendar";
import { triggerDownload } from "@/lib/download";
import { SectionTick } from "../analytics/SectionIsland";
import ConnectRateHero from "../analytics/ConnectRateHero";
import GlobalExport from "../analytics/GlobalExport";
import RangeCalendar from "../analytics/RangeCalendar";
import { CardGridSkeleton } from "../analytics/loadingSkeletons";
import AudiencePlayers, { PlayerDrawerByPhone, type PlayerFilters, DEFAULT_FILTERS, CONTACT_OPTIONS, DEPOSITED_OPTIONS } from "./AudiencePlayers";
import AudienceFamilies from "./AudienceFamilies";
import { DepositsByDay, MembersStat, ReachCard } from "./AudienceReach";
import type { AudiencePlayersResponse } from "../api/audience/players/route";
import type { AudienceReachResponse } from "../api/audience/reach/route";
import type { AudienceDepositsResponse } from "../api/audience/deposits/route";

// The mockup's market allowlist: "AU, CA, NZ. FR, PH and PL are test and trace lanes — excluded
// from audience surfaces, still visible in the campaign views." Applied as an intersection with
// what the API actually reports, so a market with no campaigns never becomes a dead tab, and the
// "QA" pseudo-market the country parser derives from test campaign names cannot appear here.
const AUDIENCE_MARKETS = ["Australia", "Canada", "New Zealand"] as const;

// The dashboard's presets (Campaign Performance, Global): [caption, days back incl. today]; 0 = all time.
const RANGE_PRESETS: [string, number][] = [["7d", 7], ["14d", 14], ["30d", 30], ["60d", 60], ["90d", 90], ["All", 0]];
const DEFAULT_DAYS = 7; // Jasiel 2026-09-08; was the mockup's 14. Drives the whole page: the hero's
                        // series and its prior-window comparison, the money strip, Deposits by day,
                        // Contact this window, the player query and both exports.

interface AudienceResponse {
  rangeDays: number;
  kpis: { connected: number; voicemailEvaluated: number };
  trend: TrendPoint[];
  baseline?: DayCount[] | null;
  options: { countries: { value: string; label: string }[]; campaigns: { id: string }[] };
}

export default function AudiencePage() {
  const brand = useBrandScope();
  const todayIso = new Date().toISOString().slice(0, 10);
  // The window as two dates, the way Campaign Performance holds it: a preset lights up only while
  // the window equals it; "" and "" is all time.
  const [from, setFrom] = useState(() => addDays(todayIso, -(DEFAULT_DAYS - 1)));
  const [to, setTo] = useState(() => todayIso);
  const [calendarPicked, setCalendarPicked] = useState(false);
  // "" = every market in the allowlist, the mockup's ALL tab: "the default question".
  const [market, setMarket] = useState<string>("");
  // The mockup's `#q`: phone or name, sent to the player query once typing pauses.
  const [q, setQ] = useState("");
  const [needle, setNeedle] = useState("");
  useEffect(() => { const t = setTimeout(() => setNeedle(q.trim()), 350); return () => clearTimeout(t); }, [q]);
  const [data, setData] = useState<AudienceResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // A brand change invalidates the market: a market this brand does not dial would dead-end.
  const [prevBrand, setPrevBrand] = useState(brand);
  if (prevBrand !== brand) {
    setPrevBrand(brand);
    setMarket("");
  }

  // The window, as the routes take it: a preset key when the dates equal one (the analytics route
  // then reasons about "the prior window" the way Global does), lifetime for All, custom otherwise.
  const preset = RANGE_PRESETS.find(([, d]) => (d ? from === addDays(todayIso, -(d - 1)) && to === todayIso : from === "" && to === ""));
  const rangeKey: RangeKey = !preset ? "custom" : preset[1] === 0 ? "lifetime" : (preset[0] as RangeKey);
  const windowQs = (p: URLSearchParams) => {
    p.set("range", rangeKey);
    if (rangeKey === "custom") { p.set("from", from); p.set("to", to); }
  };
  const query = new URLSearchParams();
  windowQs(query);
  if (brand) query.set("brand", brand);
  if (market) query.set("country", market);
  const qs = query.toString();
  // Brand and market only, no window: the drawer opened from a run's numbers looks the player up
  // over all time, so the page's window cannot hide them.
  const scopeQs = (() => { const p = new URLSearchParams(); if (brand) p.set("brand", brand); if (market) p.set("country", market); return p.toString(); })();
  const [runPlayer, setRunPlayer] = useState<string | null>(null);

  const load = useCallback(async (s: string) => {
    setLoading(true);
    try {
      const r = await fetch(`/api/dashboard/analytics?${s}`, { cache: "no-store" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const json = (await r.json()) as AudienceResponse;
      setData(json);
      saveSnapshot(`audience.overview:${s}`, json);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Paint the last session's answer for this exact scope first, then replace it.
    const snap = loadSnapshot<AudienceResponse>(`audience.overview:${qs}`);
    if (snap) setData(snap);
    load(qs);
  }, [load, qs]);

  // The aggregate blocks: Members, Reach, Deposits by day, families. One request, scoped like the
  // list, plus the window for the deposits. Each block can be unavailable on its own.
  const [agg, setAgg] = useState<AudienceReachResponse | null>(null);
  const [aggLoading, setAggLoading] = useState(false);
  const [aggError, setAggError] = useState<string | null>(null);
  useEffect(() => {
    const ctrl = new AbortController();
    setAggLoading(true);
    const snap = loadSnapshot<AudienceReachResponse>(`audience.reach:${qs}`);
    if (snap) setAgg(snap);
    fetch(`/api/audience/reach?${qs}`, { cache: "no-store", signal: ctrl.signal })
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then((j: AudienceReachResponse) => { setAgg(j); saveSnapshot(`audience.reach:${qs}`, j); setAggError(null); })
      .catch((e: unknown) => { if (!(e instanceof Error && e.name === "AbortError")) setAggError(e instanceof Error ? e.message : "Failed to load"); })
      .finally(() => setAggLoading(false));
    return () => ctrl.abort();
  }, [qs]);
  const laneCount = market ? 1 : new Set((agg?.families ?? []).map((f) => f.market).filter(Boolean)).size;

  // The player query: filters, sort, page, search, the window. A new scope or filter starts at page one.
  const [filters, setFilters] = useState<PlayerFilters>(DEFAULT_FILTERS);
  const [page, setPage] = useState(1);
  const [players, setPlayers] = useState<AudiencePlayersResponse | null>(null);
  const [playersLoading, setPlayersLoading] = useState(false);
  const [playersError, setPlayersError] = useState<string | null>(null);
  const playersQs = (() => {
    const p = new URLSearchParams();
    windowQs(p);
    if (brand) p.set("brand", brand);
    if (market) p.set("country", market);
    if (filters.deposited !== "any") p.set("deposited", filters.deposited);
    if (filters.contact !== "any") p.set("contact", filters.contact);
    if (filters.family) p.set("family", filters.family);
    if (filters.sort !== "last_contact") p.set("sort", filters.sort);
    if (filters.dir !== "desc") p.set("dir", filters.dir);
    if (needle) p.set("q", needle);
    return p.toString();
  })();
  const [prevPlayersQs, setPrevPlayersQs] = useState(playersQs);
  if (prevPlayersQs !== playersQs) { setPrevPlayersQs(playersQs); setPage(1); }
  // The in-flight players request, so the strip's request below can wait for it. Four heavy requests
  // fired together on load pushed the players statement over the database's 8 s limit and the table
  // 500'd on three loads out of five (2026-09-10, 20:10 UTC). The table is the thing being filtered;
  // the strip above it can arrive a moment later.
  const playersInFlight = useRef<Promise<unknown> | null>(null);
  useEffect(() => {
    const ctrl = new AbortController();
    setPlayersLoading(true);
    const p = fetch(`/api/audience/players?${playersQs}&page=${page}`, { cache: "no-store", signal: ctrl.signal })
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then((j: AudiencePlayersResponse) => { setPlayers(j); setPlayersError(null); })
      .catch((e: unknown) => { if (!(e instanceof Error && e.name === "AbortError")) setPlayersError(e instanceof Error ? e.message : "Failed to load players"); })
      .finally(() => setPlayersLoading(false));
    playersInFlight.current = p;
    return () => ctrl.abort();
  }, [playersQs, page]);

  // The money strip and the Deposits-by-day chart follow the table's filters (Jasiel 2026-09-10: "a
  // number beside a filter should obey it"). One request keyed on the scope, the window, the three
  // filters and the search, so "Spoke with them" turns the strip into those players' money. Declared
  // AFTER `filters` and `needle`, which it reads (a helper hoisted above its state throws at runtime
  // and tsc is silent). The snapshot key carries the filters, or a stale unfiltered strip would paint
  // under a filtered table; on a filter change the strip goes to its skeleton until the answer lands.
  const depQs = (() => {
    const p = new URLSearchParams(qs);
    if (filters.deposited !== "any") p.set("deposited", filters.deposited);
    if (filters.contact !== "any") p.set("contact", filters.contact);
    if (filters.family) p.set("family", filters.family);
    if (needle) p.set("q", needle);
    return p.toString();
  })();
  const [deps, setDeps] = useState<AudienceDepositsResponse | null>(null);
  useEffect(() => {
    const ctrl = new AbortController();
    const snap = loadSnapshot<AudienceDepositsResponse>(`audience.deposits:${depQs}`);
    setDeps(snap ?? null);
    // After the table's request settles, whatever its outcome: one fewer heavy statement in flight
    // at the moment the page loads. The effects run in declaration order, so the players effect
    // above has already set the ref for this same change of filters.
    Promise.resolve(playersInFlight.current).catch(() => undefined)
      .then(() => fetch(`/api/audience/deposits?${depQs}`, { cache: "no-store", signal: ctrl.signal }))
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then((j: AudienceDepositsResponse) => { setDeps(j); saveSnapshot(`audience.deposits:${depQs}`, j); })
      .catch((e: unknown) => { if (!(e instanceof Error && e.name === "AbortError")) setDeps({ scopeCampaigns: 0, deposits: null, reach: null, from: "", to: "", unavailable: e instanceof Error ? e.message : "Failed to load" }); });
    return () => ctrl.abort();
  }, [depQs]);

  // Export players: the whole filtered set as CSV, from the same query, never the page.
  const [exporting, setExporting] = useState(false);
  const exportPlayers = async () => {
    setExporting(true);
    try {
      const r = await fetch(`/api/audience/players?${playersQs}&format=csv`, { cache: "no-store" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const stem = ["audience-players", brand || "all-brands", market ? market.toLowerCase().replace(/\s+/g, "-") : "all-markets", rangeKey === "custom" ? `${from}_${to}` : rangeKey === "lifetime" ? "all-time" : rangeKey].join("_");
      triggerDownload(await r.blob(), `${stem}.csv`);
    } catch (e) {
      setPlayersError(e instanceof Error ? e.message : "Export failed");
    } finally {
      setExporting(false);
    }
  };

  // Reach is materially estimated when a big share of connects are not yet evaluated for
  // voicemail (detection is forward-only), same rule and threshold as Global Performance.
  const k = data?.kpis;
  const estimated = !!k && k.connected > 0 && k.voicemailEvaluated / k.connected < 0.8;

  const markets = (data?.options.countries ?? []).filter((c) =>
    (AUDIENCE_MARKETS as readonly string[]).includes(c.value),
  );
  const runDates = (agg?.families ?? []).flatMap((f) => f.runList.map((r) => (r.startAt ?? "").slice(0, 10))).filter(Boolean);
  const familyOptions = (agg?.families ?? []).map((f) => ({ value: f.key, label: f.label }));
  // The words the strip prints for the active filters, taken from the same option lists the table's
  // selects show, so the strip and the select never disagree on a name. Empty when nothing is set.
  const filterWords = [
    filters.deposited !== "any" ? DEPOSITED_OPTIONS.find((o) => o.value === filters.deposited)?.label : "",
    filters.contact !== "any" ? CONTACT_OPTIONS.find((o) => o.value === filters.contact)?.label : "",
    filters.family ? (familyOptions.find((o) => o.value === filters.family)?.label ?? filters.family) : "",
    needle ? `search "${needle}"` : "",
  ].filter(Boolean).join(" · ");

  return (
    <div className="px-[30px] pt-4 pb-16 w-full max-w-[1680px] mx-auto grid gap-4">
      {/* The mockup's `.top`: title, market tabs, and the member search at the right. Markets stay
          with the content they filter; brand is the sidebar switcher. */}
      <div className="flex items-center gap-[13px] flex-wrap">
        <div className="flex items-center gap-2.5">
          <SectionTick color="#5b9bf0" />
          <h1 className="text-lg font-semibold tracking-tight">Audience</h1>
        </div>
        <div role="tablist" aria-label="Markets" className="inline-flex items-center gap-0.5 p-0.5 rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)]">
          {[{ value: "", label: "All markets" }, ...markets].map((m) => {
            const on = market === m.value;
            return (
              <button
                key={m.value || "all"}
                type="button"
                role="tab"
                aria-selected={on}
                onClick={() => setMarket(m.value)}
                className={`px-[11px] py-1 rounded-md text-[12px] transition-colors ${
                  on ? "bg-[var(--bg-hover)] text-[var(--text-1)]" : "text-[var(--text-3)] hover:text-[var(--text-2)]"
                }`}
              >
                {m.label}
              </button>
            );
          })}
        </div>
        {/* The search moved into the Player activity card with the Export button (Jasiel 2026-09-08):
            it only ever filtered THAT table, so a box in the page header read as a page-wide search. */}
      </div>

      {/* The dashboard's range control (Campaign Performance's toolbar): Export first, then the
          presets, then the window picker at the right. One control drives the hero, the deposits,
          the player query and both exports; a page range and a card range that can disagree is a
          bug generator. A preset lights only while the window equals it. */}
      <div className="flex items-center gap-2 flex-wrap">
        <GlobalExport
          filters={{ range: rangeKey, from: rangeKey === "custom" ? from : undefined, to: rangeKey === "custom" ? to : undefined, campaignIds: [], country: market, prompt: "", phone: "" }}
          scopeIds={brand ? (data?.options.campaigns ?? []).map((c) => c.id) : null}
          disabled={!data}
        />
        {/* "Export players" moved into the Player activity card, beside its filters and count (Jasiel
            2026-09-08: it exports THAT list with THOSE filters, so it belongs where the filters are; up
            here, next to the page-wide call-records Export, it read as a second page export). */}
        <div className="inline-flex p-[3px] gap-0.5 rounded-[9px] bg-[var(--bg-elevated)] border border-[var(--border)]">
          {RANGE_PRESETS.map(([key, days]) => {
            const pf = days ? addDays(todayIso, -(days - 1)) : "";
            const pt = days ? todayIso : "";
            const on = from === pf && to === pt;
            return (
              <button
                key={key}
                type="button"
                aria-pressed={on}
                onClick={() => { setFrom(pf); setTo(pt); setCalendarPicked(false); }}
                className={`px-2.5 py-1 rounded-md text-[12.5px] font-semibold font-mono transition ${on ? "bg-primary text-white" : "text-[var(--text-3)] hover:text-[var(--text-1)]"}`}
              >
                {key}
              </button>
            );
          })}
        </div>
        {(loading || aggLoading) && <span className="text-[11px] text-[var(--text-3)] ml-1">Updating…</span>}
        {(error || aggError) && <span className="text-[11px] text-amber-400 font-mono ml-1">{error ?? aggError}</span>}
        <div className="ml-auto">
          <RangeCalendar
            from={from}
            to={to}
            runDates={runDates}
            onApply={(f, t) => { setFrom(f); setTo(t); setCalendarPicked(!!(f || t)); }}
            ariaLabel="Pick the Audience window"
            label={calendarPicked ? undefined : "Pick a window"}
          />
        </div>
      </div>

      {data ? (
        <ConnectRateHero
          trend={data.trend}
          baseline={data.baseline ?? null}
          rangeDays={data.rangeDays}
          todayIso={todayIso}
          estimated={estimated}
          noBaselineWhy={data.baseline === undefined ? "This deployment's API does not return a baseline yet." : undefined}
          lead={<MembersStat reach={agg?.reach ?? null} families={agg?.families.length ?? 0} lanes={laneCount} unavailable={agg?.unavailable.reach} />}
        />
      ) : (
        <CardGridSkeleton />
      )}

      {/* Order (Jasiel 2026-09-07): the money, the channels, the players, and the campaign families last;
          the mockup had the families above the players, and they read as a wall between the two. */}
      <DepositsByDay deposits={deps?.deposits ?? null} unavailable={deps?.unavailable} filterWords={filterWords} />
      <ReachCard reach={deps?.reach ?? null} from={deps?.from} to={deps?.to} unavailable={deps?.unavailableReach} filterWords={filterWords} />

      {playersError && <p className="text-[11px] text-amber-400 font-mono px-1">{playersError}</p>}
      <AudiencePlayers
        data={players}
        onExport={exportPlayers}
        exporting={exporting}
        query={q}
        onQuery={setQ}
        page={page}
        onPage={setPage}
        loading={playersLoading}
        showMarket={!market}
        marketLabel={market}
        brandLabel={brand ? brandLabel(brand) : ""}
        filters={filters}
        onFilters={setFilters}
        familyOptions={familyOptions}
        searching={!!needle}
      />

      <AudienceFamilies families={agg?.families ?? []} loading={aggLoading} showMarket={!market} unavailable={agg?.unavailable.families} onOpenPlayer={setRunPlayer} />
      {runPlayer && <PlayerDrawerByPhone key={runPlayer} phone={runPlayer} brandLabel={brand ? brandLabel(brand) : ""} scopeQs={scopeQs} onClose={() => setRunPlayer(null)} />}
    </div>
  );
}
