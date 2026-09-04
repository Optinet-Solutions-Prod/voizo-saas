"use client";

// src/app/audience/page.tsx
//
// Audience — the real tab, ported from the canonical mockup (2026-08-25 v4, VOZ-457) which until
// now shipped only as the frozen snapshot at /audience/preview. Laid out in the mockup's order
// (`render()`): the top row is the title, the market tabs and the member search; the scope below
// opens with the range bar (presets, Export at the right), then the connect-rate hero, then the
// player list. The Lead Recycling page that used to live here moved to /audience/lead-recycling,
// unlinked (its `local_segments` table has never held a row in prod).
//
// WHAT IS DELIBERATELY NOT HERE YET, so nothing on this page is a stale number dressed as a live
// one (the preview keeps the ribbon that lets it show frozen figures honestly):
//   - Members / campaign-families counts, and the count on each market tab: distinct phones per
//     lane has no aggregate in the DB. The roster RPC is per campaign and a phone sits in several,
//     so summing double-counts. 2026-09-04_audience_lane_reach_rpc.sql is written, not applied.
//   - The two deposit-lift tiles: the frozen 25 Aug study, not recomputable until live deposits
//     cover a real window.
//   - Channels, SMS fate, families, depositors: slices 2, 3 and 5.
//
// Connect rate is the DASHBOARD's definition (status completed/answered), not the mockup's
// stricter "clean hangup with talk time". Measured over the last 7 days they differ by 19 calls
// of 4,841 (85.1% vs 84.7%), all clean hangups at zero seconds. One definition across both tabs
// beats two that disagree on the same lane by a rounding error.
//
// Data: /api/dashboard/analytics (hero) and /api/audience/players (list), both scoped by the
// sidebar brand and the market tab. Read-only, no provider spend, nothing near the call or SMS path.

import { useCallback, useEffect, useState } from "react";
import { Search, X } from "lucide-react";
import { loadSnapshot, saveSnapshot } from "@/lib/sessionSnapshot";
import { useBrandScope } from "@/lib/brandScope";
import { brandLabel } from "@/lib/campaignDisplay";
import type { TrendPoint } from "@/lib/dashboardAnalytics";
import type { DayCount } from "@/lib/connectRateHero";
import type { RangeKey } from "@/lib/rangeWindow";
import { SectionTick } from "../analytics/SectionIsland";
import ConnectRateHero from "../analytics/ConnectRateHero";
import GlobalExport from "../analytics/GlobalExport";
import { CardGridSkeleton } from "../analytics/loadingSkeletons";
import AudiencePlayers from "./AudiencePlayers";
import type { AudiencePlayerRow } from "../api/audience/players/route";

// The mockup's market allowlist: "AU, CA, NZ. FR, PH and PL are test and trace lanes — excluded
// from audience surfaces, still visible in the campaign views." Applied as an intersection with
// what the API actually reports, so a market with no campaigns never becomes a dead tab, and the
// "QA" pseudo-market the country parser derives from test campaign names cannot appear here.
const AUDIENCE_MARKETS = ["Australia", "Canada", "New Zealand"] as const;

// The mockup's own range bar. 14d default: its hero is a 14-day series against the prior window.
const RANGES: readonly RangeKey[] = ["7d", "14d", "30d"];
const DEFAULT_RANGE: RangeKey = "14d";

interface AudienceResponse {
  rangeDays: number;
  kpis: { connected: number; voicemailEvaluated: number };
  trend: TrendPoint[];
  baseline?: DayCount[] | null;
  options: { countries: { value: string; label: string }[]; campaigns: { id: string }[] };
}

export default function AudiencePage() {
  const brand = useBrandScope();
  const [range, setRange] = useState<RangeKey>(DEFAULT_RANGE);
  // "" = every market in the allowlist, the mockup's ALL tab: "the default question".
  const [market, setMarket] = useState<string>("");
  // The mockup's `#q`: phone or name, filtering the member list.
  const [q, setQ] = useState("");
  const [data, setData] = useState<AudienceResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // A brand change invalidates the market: a market this brand does not dial would dead-end.
  const [prevBrand, setPrevBrand] = useState(brand);
  if (prevBrand !== brand) {
    setPrevBrand(brand);
    setMarket("");
  }

  const query = new URLSearchParams({ range });
  if (brand) query.set("brand", brand);
  if (market) query.set("country", market);
  const qs = query.toString();

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

  // Player activity: the 100 most recently contacted players in the same scope. Its own request,
  // so a slow list never holds the hero back, and its own error line.
  const [players, setPlayers] = useState<AudiencePlayerRow[]>([]);
  const [playersLoading, setPlayersLoading] = useState(false);
  const [playersError, setPlayersError] = useState<string | null>(null);
  const scopeQs = (() => { const p = new URLSearchParams(); if (brand) p.set("brand", brand); if (market) p.set("country", market); return p.toString(); })();
  useEffect(() => {
    const ctrl = new AbortController();
    setPlayersLoading(true);
    fetch(`/api/audience/players?${scopeQs}`, { cache: "no-store", signal: ctrl.signal })
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then((j: { rows: AudiencePlayerRow[] }) => { setPlayers(j.rows ?? []); setPlayersError(null); })
      .catch((e: unknown) => { if (!(e instanceof Error && e.name === "AbortError")) setPlayersError(e instanceof Error ? e.message : "Failed to load players"); })
      .finally(() => setPlayersLoading(false));
    return () => ctrl.abort();
  }, [scopeQs]);

  // Reach is materially estimated when a big share of connects are not yet evaluated for
  // voicemail (detection is forward-only), same rule and threshold as Global Performance.
  const k = data?.kpis;
  const estimated = !!k && k.connected > 0 && k.voicemailEvaluated / k.connected < 0.8;

  const markets = (data?.options.countries ?? []).filter((c) =>
    (AUDIENCE_MARKETS as readonly string[]).includes(c.value),
  );

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
        <label className="ml-auto relative">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-4)] pointer-events-none" />
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Phone or name"
            aria-label="Search members"
            className="pl-8 pr-7 py-1.5 w-[210px] text-[13px] rounded-[9px] bg-[var(--bg-elevated)] border border-[var(--border)] text-[var(--text-1)] placeholder:text-[var(--text-4)] focus:outline-none focus:border-primary transition"
          />
          {q && (
            <button type="button" aria-label="Clear the search" onClick={() => setQ("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--text-3)] hover:text-[var(--text-1)]">
              <X size={13} />
            </button>
          )}
        </label>
      </div>

      {/* The mockup's `rangebar()`: presets, then Export at the right. One control drives the hero
          and the export; a page range and a card range that can disagree is a bug generator. */}
      <div className="flex items-center gap-[5px] flex-wrap">
        {RANGES.map((key) => (
          <button
            key={key}
            type="button"
            aria-pressed={range === key}
            onClick={() => setRange(key)}
            className={`px-[9px] py-1 rounded-md text-[12px] font-mono border transition ${
              range === key
                ? "border-primary text-[var(--text-1)] bg-[var(--bg-elevated)]"
                : "border-[var(--border)] text-[var(--text-3)] bg-[var(--bg-elevated)] hover:border-[var(--border-2)] hover:text-[var(--text-2)]"
            }`}
          >
            {key}
          </button>
        ))}
        {loading && <span className="text-[11px] text-[var(--text-3)] ml-1">Updating…</span>}
        {error && <span className="text-[11px] text-amber-400 font-mono ml-1">{error}</span>}
        <div className="ml-auto">
          {/* The records export engine, scoped like the dashboard's: the market as the country
              filter and, under a brand, the brand's in-window campaign ids (the records routes
              know no brand). It refuses past the routes' campaign cap rather than truncating. */}
          <GlobalExport
            filters={{ range, campaignIds: [], country: market, prompt: "", phone: "" }}
            scopeIds={brand ? (data?.options.campaigns ?? []).map((c) => c.id) : null}
            disabled={!data}
          />
        </div>
      </div>

      {data ? (
        <ConnectRateHero
          trend={data.trend}
          baseline={data.baseline ?? null}
          rangeDays={data.rangeDays}
          todayIso={new Date().toISOString().slice(0, 10)}
          estimated={estimated}
          noBaselineWhy={data.baseline === undefined ? "This deployment's API does not return a baseline yet." : undefined}
        />
      ) : (
        <CardGridSkeleton />
      )}

      {playersError && <p className="text-[11px] text-amber-400 font-mono px-1">{playersError}</p>}
      <AudiencePlayers rows={players} loading={playersLoading} showMarket={!market} query={q} brandLabel={brand ? brandLabel(brand) : ""} />
    </div>
  );
}
