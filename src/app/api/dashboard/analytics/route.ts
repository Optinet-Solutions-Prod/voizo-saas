import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseServer";
import {
  buildCampaignIndex,
  filterCalls,
  computeGlobalKpis,
  computePromptRollups,
  computeTrend,
  computeDailyVolume,
  computeMarketComparison,
  computeHeatmap,
  representativeBaseBySha,
  bestByPositiveResponse,
  smsSentByCampaign,
  computeRangedPerf,
  perfForCampaignScope,
  type DashCallRow,
  type DashCampaignRow,
  type DashSmsRow,
  type TodayPerfDay,
  type CallRollupRow,
} from "@/lib/dashboardAnalytics";
import { baselineSeries } from "@/lib/connectRateHero";
import { resolvePromptByCampaign } from "@/lib/promptResolution";
import { fetchAllRows, fetchAllRowsParallel } from "@/lib/supabaseFetchAll";
import { formatCampaign, campaignIdsForCountry, brandKey } from "@/lib/campaignDisplay";
import { rangeToWindow, MS_PER_DAY } from "@/lib/rangeWindow";

/**
 * GET /api/dashboard/analytics
 *
 * The filtered "Global Performance" data (Val's spec). The filter bar drives this:
 *   range=7d|14d|30d (default 30d) · campaigns=id,id · agent=<voice_id> · phone=<free text>
 * (prompt= is deferred to the prompt-attribution slice.)
 *
 * Returns the KPI grid (Row 1 totals + Row 2 best campaign/agent), the dropdown option
 * lists, and any phone-lookup match banner. Ghost + test campaigns excluded by filterCalls.
 * Success% = goal/connected; Connect = ANSWER (completed, incl. voicemail). Read-only.
 */
export async function GET(request: NextRequest) {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  if (origin && host) {
    try {
      if (new URL(origin).host !== host) {
        return NextResponse.json({ error: "Forbidden — cross-origin" }, { status: 403 });
      }
    } catch {
      return NextResponse.json({ error: "Forbidden — invalid origin" }, { status: 403 });
    }
  }

  const { searchParams } = new URL(request.url);
  const rangeKey = searchParams.get("range") ?? "30d";
  const campaignsParam = searchParams.get("campaigns");
  const campaignIds = campaignsParam ? campaignsParam.split(",").filter(Boolean) : null;
  const country = searchParams.get("country");
  const promptSha = searchParams.get("prompt");
  const phone = (searchParams.get("phone") ?? "").trim();
  // Page-level brand scope (mockup, 2026-09-03): a brand key, or blank for all brands.
  const brand = (searchParams.get("brand") ?? "").trim().toLowerCase();

  const now = Date.now();
  // Range → window: presets (7d…90d), "lifetime", or a custom from/to pair (shared resolver).
  const { startMs, endMs } = rangeToWindow(rangeKey, now, searchParams.get("from"), searchParams.get("to"));
  const startIso = new Date(startMs).toISOString();
  const rangeDays = Math.round((endMs - startMs) / MS_PER_DAY);

  // Baseline for the Global connect-rate hero (2026-09-02): the equal-length window immediately
  // BEFORE this one, as per-campaign-per-day counts from the SQL rollup the Today and Campaigns
  // routes already use (parity-tested against the JS in dashboardRollup.parity.test.ts). Fired
  // here so it runs alongside the big reads. Skipped for lifetime (no equal-length window
  // exists) and for a phone search (the rollup has no per-number grain): the hero then says
  // "no comparable baseline" instead of guessing. A failure degrades to null, loudly, and the
  // rest of the page is untouched.
  const baselineWanted = rangeKey !== "lifetime" && !phone;
  const baselinePromise: Promise<CallRollupRow[] | null> = baselineWanted
    ? (async () => {
        try {
          const r = await supabaseAdmin.rpc("dashboard_call_rollup", {
            p_start: new Date(startMs - (endMs - startMs)).toISOString(),
            p_end: startIso, // the rollup is [p_start, p_end); the window is [startMs, endMs]
          });
          if (r.error) throw r.error;
          return (r.data ?? []) as CallRollupRow[];
        } catch (err: unknown) {
          console.error("[dashboard/analytics] baseline rollup failed — hero shows no baseline:", err);
          return null;
        }
      })()
    : Promise.resolve(null);

  // Phone lookup → matching campaign_number_ids + the campaigns they belong to.
  let numberIds: string[] | null = null;
  const matchedCampaignIds = new Set<string>();
  if (phone) {
    const needle = phone.replace(/[^\d+]/g, "");
    if (needle) {
      const { data: nums } = await supabaseAdmin
        .from("campaign_numbers_v2")
        .select("id, campaign_id, phone_e164")
        .ilike("phone_e164", `%${needle}%`)
        .limit(2000);
      numberIds = (nums ?? []).map((n) => n.id as string);
      (nums ?? []).forEach((n) => matchedCampaignIds.add(n.campaign_id as string));
    }
  }

  // Page past PostgREST's 1000-row cap — CONCURRENTLY (2026-08-05). The 30d window
  // holds ~49k calls_v2 rows (post-incident) = ~50 pages; fetchAllRows awaited them
  // one at a time at ~530ms per Vercel→Supabase hop, which is most of why this route
  // measured 88s on prod. fetchAllRowsParallel fires the pages through a pool (gte
  // applied to count AND pages). Failure shape: THROWS instead of the old silent
  // prefix-partial — the catch degrades that ONE bucket to [] (loud), so a table
  // failure skews a section rather than 500ing the dashboard, same intent as before.
  const read = (table: string, columns: string, win?: { column: string; value: string }) =>
    fetchAllRowsParallel(supabaseAdmin, table, columns, "id", win).catch((err: unknown) => {
      console.error(`[dashboard/analytics] ${table} read failed — degraded to []:`, err);
      return [] as Awaited<ReturnType<typeof fetchAllRowsParallel>>;
    });

  // 2026-09-12: transcripts for the CANDIDATE calls only — connected, not voicemail, not a goal.
  // deriveAttemptTag returns before the transcript branch for every other call, so nothing else
  // needs one, and fetching the lot would be ruinous on a route that already pages ~49k rows for
  // 30d (and once measured 88s on prod). Measured 2026-09-12: 1,452 rows / 0.3 MB / 546 ms at 7d,
  // 7,401 / 1.8 MB / 1,030 ms at 30d, 10,342 / 1.4 s at 90d — against a main read of 29 to 83
  // pages, so this is nowhere near the critical path and runs inside the same Promise.all for no
  // added wall clock. Kept SEQUENTIAL for that reason: parallelising it would optimise a leg that
  // is not the bottleneck.
  //
  // fetchAllRowsParallel takes a single gte and cannot express the candidate predicate, so this
  // keyset-pages the way /api/dashboard/campaigns does for the same set.
  //
  // FAILS SOFT, but the soft landing is built BELOW, not here. An empty map does NOT on its own
  // restore the lean answer: the strict classifier reads a missing transcript as "" and therefore
  // as a SILENT PICKUP, so an empty map alone would render "Conversations established 0, Silent
  // pickup 1,491". The coverage check before computeRangedPerf is what turns a failed fetch into
  // the honest lean split. Returning {} here is only safe because of it.
  const endIso = new Date(endMs).toISOString();
  // A plain keyed OBJECT rather than a Map, deliberately. react-doctor's P0
  // nextjs-no-side-effect-in-get-handler reads `out.set(...)` inside a GET handler as a CSRF-prone
  // side effect, and then read `Object.create()` the same way — it pattern-matches method calls
  // rather than following the data, and `out` is function-local, never escapes the request and
  // writes nothing. An object literal is exactly as good for a string-keyed lookup and leaves the
  // file at the 92/100 it scored before this change, instead of parking a P0 that every future
  // commit here has to re-argue. Keys are call UUIDs, so a `__proto__` key cannot arise.
  const readCandidateTranscripts = async (): Promise<Record<string, DashCallRow["transcript"]>> => {
    const out: Record<string, DashCallRow["transcript"]> = {};
    try {
      let lastId = "00000000-0000-0000-0000-000000000000";
      for (;;) {
        const { data, error } = await supabaseAdmin
          .from("calls_v2")
          .select("id, transcript")
          .gte("created_at", startIso)
          .lte("created_at", endIso)
          .in("status", ["completed", "answered"])
          .not("voicemail", "is", true)
          .not("goal_reached", "is", true)
          .order("id", { ascending: true })
          .gt("id", lastId)
          .limit(1000);
        if (error) throw new Error(error.message);
        const rows = (data ?? []) as unknown as Array<{ id: string; transcript: DashCallRow["transcript"] }>;
        for (const r of rows) out[r.id] = r.transcript;
        if (rows.length < 1000) break;
        lastId = rows[rows.length - 1].id;
      }
      return out;
    } catch (e) {
      console.error("[dashboard/analytics] candidate transcript read failed — Global Performance falls back to the lean split:", e);
      return {};
    }
  };

  const [callRows, campaignRows, smsRows, transcriptById] = await Promise.all([
    read(
      "calls_v2",
      "id, campaign_id, campaign_number_id, status, goal_reached, created_at, voicemail, ended_reason, duration_seconds",
      { column: "created_at", value: startIso },
    ),
    read(
      "campaigns_v2",
      // cio_workspace: the brand scope shown on the Global Performance header (VOZ-216).
      // parent_campaign_id: lets the client collapse the daily children under their recurring
      // parent in the campaigns filter — read-only, no effect on any metric.
      "id, name, status, source, is_test, campaign_type, parent_campaign_id, voice_id, vapi_assistant_name, base_assistant_id, cio_workspace, system_prompt, start_at, created_at, end_at, timezone",
    ),
    // SMS-sent series/columns (Slice 3): windowed, scoped to in-filter campaigns below.
    read(
      "sms_messages_v2",
      "campaign_id, created_at, status, call_id, campaign_number_id",
      { column: "created_at", value: startIso },
    ),
    readCandidateTranscripts(),
  ]);

  const campaigns = campaignRows as unknown as (DashCampaignRow & { system_prompt?: string | null })[];
  const index = buildCampaignIndex(campaigns);
  const liveAll = campaigns.filter((c) => c.source !== "ghost_portal" && c.is_test !== true);
  // Brand scope narrows the live set at the source, so the options, the country ids, the
  // baseline and the SMS scope below all follow it without a second filter each.
  const live = brand ? liveAll.filter((c) => brandKey(c.cio_workspace) === brand) : liveAll;

  // Per-campaign prompt identity (sha + label + base agent) — shared resolver (chunked .in()).
  const promptByCampaign = await resolvePromptByCampaign(live);

  let filtered = filterCalls(
    callRows as unknown as DashCallRow[],
    { startMs, endMs, campaignIds, numberIds },
    index,
  );
  if (brand) {
    const brandIds = new Set(live.map((c) => c.id));
    filtered = filtered.filter((c) => brandIds.has(c.campaign_id));
  }
  // Country filter (replaces the agent filter): keep calls whose campaign parses to the chosen country.
  if (country) {
    const countryIds = campaignIdsForCountry(live, country);
    filtered = filtered.filter((c) => countryIds.has(c.campaign_id));
  }
  // Prompt filter (prompt is per-campaign in v1): keep calls whose campaign's prompt hash matches.
  if (promptSha) filtered = filtered.filter((c) => promptByCampaign.get(c.campaign_id)?.sha === promptSha);

  // The baseline keeps exactly the campaigns the window kept: live (no ghost, no test), in the
  // picker if one is set, in the country if one is set, on the prompt if one is set.
  const liveIds = new Set(live.map((c) => c.id));
  const pickedIds = campaignIds && campaignIds.length ? new Set(campaignIds) : null;
  const countryIdSet = country ? campaignIdsForCountry(live, country) : null;
  const keepInBaseline = (id: string) =>
    liveIds.has(id) &&
    (!pickedIds || pickedIds.has(id)) &&
    (!countryIdSet || countryIdSet.has(id)) &&
    (!promptSha || promptByCampaign.get(id)?.sha === promptSha);
  const baselineRows = await baselinePromise;
  const baseline = baselineRows ? baselineSeries(baselineRows, keepInBaseline) : null;

  const global = computeGlobalKpis(filtered, index);
  const prompts = computePromptRollups(filtered, promptByCampaign);
  const bestPrompt = bestByPositiveResponse(prompts, (r) => ({ key: r.sha, label: r.label }));

  // SMS-sent (Slice 3): scope to the campaigns the call filter kept, then count per campaign /
  // per base-agent / per prompt sha so the ranked tables + trend can surface "SMS sent".
  const inScopeCampaigns = new Set(filtered.map((c) => c.campaign_id));
  const scopedSms = (smsRows as unknown as DashSmsRow[]).filter((m) => inScopeCampaigns.has(m.campaign_id));
  const smsByCampaign = smsSentByCampaign(scopedSms);
  const smsByAgent = new Map<string, number>();
  const smsByPrompt = new Map<string, number>();
  for (const [campId, n] of smsByCampaign) {
    const agentId = index.get(campId)?.base_assistant_id ?? null;
    if (agentId) smsByAgent.set(agentId, (smsByAgent.get(agentId) ?? 0) + n);
    const sha = promptByCampaign.get(campId)?.sha ?? null;
    if (sha) smsByPrompt.set(sha, (smsByPrompt.get(sha) ?? 0) + n);
  }

  // Declined contacts for the Reached split — FLIPPED (2026-08-05): the old loop sent
  // every distinct in-window contact id through sequential .in() chunks of 150 to ask
  // "which of these are declined?" — at the incident-scale window that was 200+ serial
  // round-trips to find what is globally ~20 rows. Ask the other direction instead:
  // ONE indexed read of ALL outcome='declined_offer' rows (fetchAllRows pages if it
  // ever outgrows a page), then intersect with the filtered set in JS. Same result set
  // by construction: {id : outcome=declined AND id ∈ filtered contacts}.
  const declinedIds = new Set<string>();
  const filteredNumIds = new Set(filtered.map((c) => c.campaign_number_id).filter((x): x is string => !!x));
  // fetchAllRows degrades to partial on error (loud-logged) — the Reached→Declined
  // split under-counts slightly in that case; everything else is fine (as before).
  const declinedRows = await fetchAllRows(supabaseAdmin, "campaign_numbers_v2", "id", "id", {
    column: "outcome",
    value: "declined_offer",
  });
  for (const n of declinedRows as Array<{ id: string }>) {
    if (filteredNumIds.has(n.id)) declinedIds.add(n.id);
  }

  // Ranged 3-card Performance (Global Performance, Val's mockup). Reuses the already-filtered in-memory
  // call set (no extra fetch) + the lean transcript-less classifier. Isolated failure domain: a perf
  // error must NOT take down the charts/tables/leaderboard, so degrade to perf:null and log with counts.
  // Splice the candidate transcripts onto the filtered set (copy, never mutate the shared rows —
  // the charts, tables and leaderboard read the same objects). Non-candidates have no entry and
  // are passed through untouched, which is exactly the set deriveAttemptTag never asks about.
  // COVERAGE IS ALL OR NOTHING, and the reason is that the failure is not graceful. The strict
  // classifier asks substantiveUserTurnCount(transcriptText(call.transcript)) === 0, and
  // transcriptText(undefined) is "" — so a candidate WITHOUT its transcript attached is not
  // "classified leniently", it is classified as a SILENT PICKUP. An empty map would therefore
  // render Global Performance as "Conversations established 0, Silent pickup 1,491" rather than
  // falling back to the old lean answer the way the fetch's own comment claimed.
  //
  // So: count the rows that actually need a transcript — connected, not voicemail, not a goal, the
  // same predicate the fetch uses — and only take the strict path when every one of them has an
  // entry. `undefined` means NOT FETCHED; a row whose transcript is genuinely null is present in
  // the map with the value null, and that distinction is what makes this check meaningful.
  // A partially covered set would be neither lean nor strict, which is worse than either.
  const CONNECTED = new Set(["completed", "answered"]);
  const needsTranscript = filtered.filter(
    (c) => CONNECTED.has(String(c.status)) && c.voicemail !== true && c.goal_reached !== true,
  );
  const uncovered = needsTranscript.filter((c) => !c.id || transcriptById[c.id] === undefined).length;
  const useTranscript = needsTranscript.length === 0 || uncovered === 0;
  if (!useTranscript) {
    console.error(
      `[dashboard/analytics] ${uncovered} of ${needsTranscript.length} candidate calls have no transcript — ` +
      `falling back to the LEAN split for this window so the numbers stay explainable`,
    );
  }
  const filteredForPerf: DashCallRow[] = !useTranscript
    ? filtered
    : filtered.map((c) => {
        const t = c.id ? transcriptById[c.id] : undefined;
        return t === undefined ? c : { ...c, transcript: t };
      });

  let perf: TodayPerfDay | null = null;
  try {
    perf = computeRangedPerf(filteredForPerf, scopedSms, declinedIds, startMs, endMs, { useTranscript });
  } catch (e) {
    console.error("[dashboard/analytics] computeRangedPerf failed:", e, { calls: filtered.length, sms: scopedSms.length });
    perf = null;
  }

  // Dropdown options — only campaigns with activity in this window (calls or SMS), so stale/empty
  // ones stop cluttering the filter. Built from the RAW windowed sets (not `filtered`) so the option
  // list is stable regardless of what's currently selected. `startAt` lets the client disambiguate
  // same-named campaigns by date.
  const windowedCampaignIds = new Set<string>([
    ...(callRows as unknown as DashCallRow[]).map((c) => c.campaign_id),
    ...(smsRows as unknown as DashSmsRow[]).map((m) => m.campaign_id),
  ]);
  const inWindowLive = live.filter((c) => windowedCampaignIds.has(c.id));
  const campaignOptions = inWindowLive
    // `brand` rides along (VOZ-216): the section header derives its distinct brand
    // scope from these — the in-window campaigns are exactly what the KPIs cover.
    .map((c) => ({
      id: c.id,
      name: c.name,
      startAt: c.start_at ?? c.created_at ?? null,
      brand: c.cio_workspace ?? null,
      parentId: c.parent_campaign_id ?? null,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
  // A recurring PARENT has no calls of its own (it prints 0/0/0/0), so it is never in
  // inWindowLive — but the client needs its name to head the group its children sit under.
  // Send only the parents the in-window children actually point at.
  const referencedParentIds = new Set(
    inWindowLive.map((c) => c.parent_campaign_id).filter((id): id is string => Boolean(id)),
  );
  const campaignParentOptions = live
    .filter((c) => referencedParentIds.has(c.id))
    .map((c) => ({
      id: c.id,
      name: c.name,
      startAt: c.start_at ?? c.created_at ?? null,
      brand: c.cio_workspace ?? null,
    }));
  // Country filter options (replaces the agent filter, Val 2026-07-07): distinct parsed countries
  // among the in-window campaigns, by the SAME L7_<CC>_ parse used for filter membership. Campaigns
  // with no parseable country contribute nothing (and can't be reached by the country filter).
  const countrySet = new Set<string>();
  for (const c of inWindowLive) {
    const ctry = formatCampaign(c.name).country;
    if (ctry) countrySet.add(ctry);
  }
  const countryOptions = [...countrySet].sort().map((c) => ({ value: c, label: c }));
  const baseBySha = representativeBaseBySha(promptByCampaign);
  // First campaign that ran each prompt sha — lets the UI open the full prompt (PromptModal) for a
  // representative campaign (the per-campaign prompt endpoint is the source of the full text).
  const campaignIdBySha = new Map<string, string>();
  for (const [campId, p] of promptByCampaign) if (!campaignIdBySha.has(p.sha)) campaignIdBySha.set(p.sha, campId);
  const promptOptions = [...new Map([...promptByCampaign.values()].map((p) => [p.sha, p.label])).entries()]
    .map(([sha, label]) => ({ sha, label, baseAssistantId: baseBySha.get(sha) ?? null }))
    .sort((a, b) => a.label.localeCompare(b.label));

  const matchedCampaigns = phone
    ? campaigns.filter((c) => matchedCampaignIds.has(c.id)).map((c) => ({ id: c.id, name: c.name }))
    : [];

  // Per-entity perf for the Top Performers breakdown cards (Slice E). In-memory over the already-
  // filtered set; each isolated (try/catch → null) so one entity's failure can't drop the section.
  const bestPerf = (ids: Set<string> | null): TodayPerfDay | null => {
    if (!ids || ids.size === 0) return null;
    try {
      return perfForCampaignScope(filteredForPerf, scopedSms, declinedIds, startMs, endMs, ids, { useTranscript });
    } catch (e) {
      console.error("[dashboard/analytics] perfForCampaignScope failed:", e, { ids: ids.size });
      return null;
    }
  };
  const campaignScope = global.bestCampaign ? new Set([global.bestCampaign.key]) : null;
  const agentScope = global.bestAgent
    ? new Set(live.filter((c) => (c.base_assistant_id ?? null) === global.bestAgent!.key).map((c) => c.id))
    : null;
  const promptScope = bestPrompt
    ? new Set([...promptByCampaign].filter(([, pp]) => pp.sha === bestPrompt.key).map(([id]) => id))
    : null;

  return NextResponse.json({
    rangeDays,
    kpis: global.kpis,
    campaignCount: global.campaignCount,
    best: {
      campaign: global.bestCampaign ? { ...global.bestCampaign, perf: bestPerf(campaignScope) } : null,
      agent: global.bestAgent ? { ...global.bestAgent, perf: bestPerf(agentScope) } : null,
      prompt: bestPrompt ? { ...bestPrompt, perf: bestPerf(promptScope) } : null,
    },
    campaigns: global.campaignRollups.map((r) => ({
      id: r.id,
      name: r.name,
      country: r.country,
      status: r.status,
      baseAssistantId: r.baseAssistantId,
      calls: r.calls,
      connectRate: r.connectRate,
      successRate: r.successRate,
      reach: r.reach,
      positiveResponseRate: r.positiveResponseRate,
      smsSent: smsByCampaign.get(r.id) ?? 0,
    })),
    agents: global.agentRollups.map((r) => ({
      baseAssistantId: r.baseAssistantId,
      calls: r.calls,
      connected: r.connected,
      terminal: r.terminal,
      connectRate: r.connectRate,
      successRate: r.successRate,
      reach: r.reach,
      positiveResponseRate: r.positiveResponseRate,
      smsSent: smsByAgent.get(r.baseAssistantId) ?? 0,
      campaignCount: r.campaignCount,
    })),
    prompts: prompts.map((r) => ({
      sha: r.sha,
      label: r.label,
      baseAssistantId: r.baseAssistantId,
      campaignId: campaignIdBySha.get(r.sha) ?? null,
      calls: r.calls,
      connectRate: r.connectRate,
      successRate: r.successRate,
      reach: r.reach,
      positiveResponseRate: r.positiveResponseRate,
      smsSent: smsByPrompt.get(r.sha) ?? 0,
      campaignCount: r.campaignCount,
    })),
    trend: computeTrend(filtered, startMs, endMs, scopedSms),
    // Per-day completed/connected for the equal-length window before this one (hero delta).
    // null = no comparable baseline (lifetime, phone search, or the rollup failed).
    baseline,
    dailyVolume: computeDailyVolume(filtered, campaigns, startMs, endMs),
    // per-market calls / connected / completed for the Market Comparison card (2026-09-03)
    markets: computeMarketComparison(filtered, campaigns),
    heatmap: computeHeatmap(filtered, campaigns),
    perf,
    options: {
      campaigns: campaignOptions,
      campaignParents: campaignParentOptions,
      countries: countryOptions,
      prompts: promptOptions,
    },
    phone: { query: phone || null, matchedCampaigns },
  });
}
