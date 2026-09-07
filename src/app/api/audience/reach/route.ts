import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseServer";
import { fetchAllRows } from "@/lib/supabaseFetchAll";
import { parseCountryToken } from "@/lib/campaignAnalytics";
import { deriveDisplayStatus, type DisplayStatus } from "@/lib/dashboardAnalytics";
import { rangeToWindow } from "@/lib/rangeWindow";
import { campaignLabeller, familyKeyOf, laneCampaignIds, type FamilyCampaign } from "@/lib/audienceLane";

/**
 * GET /api/audience/reach?brand=&country=&range=
 *
 * The Audience tab's aggregate blocks (mockup 2026-08-25, slices 2, 3 and 5 of the wire), one
 * request: the Members tile and the Reach card (audience_lane_reach), the campaign families with
 * their run and member counts (the same RPC per family), and Deposits by day for the range bar's
 * window (audience_lane_deposits). Every headline here is a count of DISTINCT PLAYERS, which
 * nothing in the database answered until those two functions existed; see the two migration files
 * at the repo root for the definitions, which are copied from the dashboard's rollup, not invented.
 *
 * Lane scope and family labels come from lib/audienceLane.ts, shared with /api/audience/players.
 *
 * Blocks fail INDEPENDENTLY: a function not yet applied to the database, or a slow query, blanks
 * its own card with a reason in `unavailable` and leaves the rest of the page standing. Nothing
 * here invents a zero for a number it could not read.
 *
 * Read-only, lenient origin (GET), Basic Auth via middleware. No PII in the response.
 */

export interface LaneReach {
  members: number;
  dialled: number;
  spoke_lean: number;
  texted: number;
  text_delivered: number;
  texted_not_spoken: number;
  msgs: number;
  msgs_delivered: number;
  msgs_failed: number;
  msgs_unconfirmed: number;
}
export interface FamilyRun {
  id: string;
  name: string;
  startAt: string | null;
  status: DisplayStatus;
}
export interface AudienceFamily {
  key: string;
  label: string;
  /** Market token of the family's newest run ("AU"), for the All-markets flag. */
  market: string;
  runs: number;
  /** Distinct phones across the family's campaigns; null when the RPC is unavailable. */
  members: number | null;
  status: "running" | "paused" | "finished";
  campaignIds: string[];
  /** Newest first. */
  runList: FamilyRun[];
}
export interface DepositDay {
  day: string;
  deposits: number;
  players: number;
  amountEur: number;
  depositsBefore: number;
}
export interface DepositTotal {
  currency: string;
  deposits: number;
  players: number;
  amountLocal: number;
  amountEur: number;
  before: number;
}
export interface AudienceDeposits {
  from: string;
  to: string;
  days: DepositDay[];
  /** After-contact deposits in the window per currency (the money strip); null when unavailable. */
  totals: DepositTotal[] | null;
  /** Distinct players who deposited after contact inside the window; null when unavailable. */
  depositors: number | null;
  /** What the table can actually see: the one-off 2026-08-25 capture and the live ingress. A
   *  day outside both is "not captured", never "no deposits". */
  coverage: { captureFrom: string | null; captureTo: string | null; liveFrom: string | null };
}
/** Players who deposited after contact, LIFETIME, on the Reach card's own denominator (players ever
 *  loaded), with the gross per currency beside them. null when either function is unavailable. */
export interface LifetimeDeposited {
  players: number;
  totals: DepositTotal[];
}
export interface AudienceReachResponse {
  scopeCampaigns: number;
  reach: LaneReach | null;
  deposited: LifetimeDeposited | null;
  families: AudienceFamily[];
  deposits: AudienceDeposits | null;
  unavailable: { reach?: string; families?: string; deposits?: string };
}

const CAPTURE_SOURCE = "activities_capture_2026-08-25";
const RANK: Record<DisplayStatus, number> = { running: 0, scheduled: 0, paused: 1, finished: 2 };

async function laneReach(ids: string[]): Promise<LaneReach | null> {
  const { data, error } = await supabaseAdmin.rpc("audience_lane_reach", { p_campaign_ids: ids });
  if (error) throw new Error(error.message);
  return ((data ?? []) as LaneReach[])[0] ?? null;
}

export async function GET(request: NextRequest) {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  if (origin && host) {
    try {
      if (new URL(origin).host !== host) return NextResponse.json({ error: "Forbidden — cross-origin" }, { status: 403 });
    } catch {
      return NextResponse.json({ error: "Forbidden — invalid origin" }, { status: 403 });
    }
  }
  const sp = new URL(request.url).searchParams;
  const brand = (sp.get("brand") ?? "").trim().toLowerCase();
  const country = (sp.get("country") ?? "").trim().slice(0, 40);
  const range = (sp.get("range") ?? "14d").trim().slice(0, 12);
  const dayIso = (v: string | null) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
  const from = dayIso(sp.get("from")), to = dayIso(sp.get("to"));

  try {
    const campaigns = (await fetchAllRows(
      supabaseAdmin,
      "campaigns_v2",
      "id, name, cio_workspace, source, is_test, parent_campaign_id, campaign_type, start_at, end_at, status",
      "id",
    )) as unknown as (FamilyCampaign & { source: string | null; is_test: boolean | null; end_at: string | null; status: string | null })[];
    const live = campaigns.filter((c) => c.source !== "ghost_portal" && c.is_test !== true);
    const laneIds = laneCampaignIds(live, brand, country);
    // A recurring parent carries no country token of its own in some names; it joins the lane
    // when any of its children does, so the family list can name it.
    const parentsInLane = new Set(live.filter((c) => laneIds.has(c.id) && c.parent_campaign_id).map((c) => c.parent_campaign_id as string));
    const inLane = live.filter((c) => laneIds.has(c.id) || parentsInLane.has(c.id));
    const ids = [...laneIds];
    const unavailable: AudienceReachResponse["unavailable"] = {};
    if (ids.length === 0) {
      return NextResponse.json({ scopeCampaigns: 0, reach: null, deposited: null, families: [], deposits: null, unavailable } satisfies AudienceReachResponse);
    }

    // ── Families: Campaign Performance's rule (the recurring parent, else the run itself). ──
    const nowMs = Date.now();
    const label = campaignLabeller(live, brand);
    const byKey = new Map<string, typeof inLane>();
    for (const c of inLane) {
      const k = familyKeyOf(c);
      const g = byKey.get(k);
      if (g) g.push(c); else byKey.set(k, [c]);
    }
    const families: AudienceFamily[] = [...byKey.entries()].map(([key, list]) => {
      const runs = list
        .filter((c) => c.campaign_type !== "recurring")
        .sort((a, b) => ((a.start_at ?? "") < (b.start_at ?? "") ? 1 : -1));
      // Per campaign, the dashboard's own status derivation. A recurring parent whose schedule is
      // armed reads "scheduled" there; for a FAMILY that means alive, so it ranks with running.
      const statuses = list.map((c) =>
        deriveDisplayStatus({
          rawStatus: c.status,
          endAtMs: c.end_at ? Date.parse(c.end_at) : null,
          lastCallMs: c.start_at ? Date.parse(c.start_at) : null,
          nowMs,
          isRecurringParent: c.campaign_type === "recurring",
        }),
      );
      const best = statuses.reduce<DisplayStatus>((acc, s) => (RANK[s] < RANK[acc] ? s : acc), "finished");
      const head = list.find((c) => c.campaign_type === "recurring") ?? runs[0] ?? list[0];
      return {
        key,
        label: label(head.id),
        market: parseCountryToken((runs[0] ?? head).name ?? "") || "",
        runs: runs.length,
        members: null,
        status: best === "scheduled" ? "running" : best,
        campaignIds: list.map((c) => c.id),
        runList: runs.map((c) => ({ id: c.id, name: c.name ?? "", startAt: c.start_at ?? null, status: statuses[list.indexOf(c)] ?? "finished" })),
      };
    });
    const order = { running: 0, paused: 1, finished: 2 } as const;
    families.sort((a, b) => order[a.status] - order[b.status] || b.runs - a.runs || a.label.localeCompare(b.label));

    // ── The three RPC blocks, independently. ──
    const { startMs, endMs } = from && to ? rangeToWindow("custom", nowMs, from, to) : rangeToWindow(range, nowMs);
    const EPOCH = new Date(0).toISOString();
    const nowIso = new Date(nowMs).toISOString();
    const totalsRpc = async (fromIso: string, toIso: string) => {
      const { data, error } = await supabaseAdmin.rpc("audience_lane_deposit_totals", { p_campaign_ids: ids, p_from: fromIso, p_to: toIso });
      if (error) throw new Error(error.message);
      return ((data ?? []) as { currency: string; deposits: number; players: number; amount_local: number | string; amount_eur: number | string; deposits_before: number }[])
        .map((t) => ({ currency: t.currency, deposits: t.deposits, players: t.players, amountLocal: Number(t.amount_local) || 0, amountEur: Number(t.amount_eur) || 0, before: t.deposits_before }));
    };
    // Distinct depositors: the players query with the depositor filter, one row, because a player who
    // deposited in two currencies must count once.
    const depositorsRpc = async (fromIso: string, toIso: string) => {
      const { data, error } = await supabaseAdmin.rpc("audience_lane_players", {
        p_campaign_ids: ids, p_from: fromIso, p_to: toIso,
        p_deposited: "after", p_contact: "any", p_family_ids: null, p_q: null, p_sort: "last_contact", p_dir: "desc", p_limit: 1, p_offset: 0,
      });
      if (error) throw new Error(error.message);
      const first = ((data ?? []) as { total_count: number | string }[])[0];
      return first ? Number(first.total_count) : 0;
    };
    const [reachRes, famRes, depRes, covRes, totRes, depositorsRes, lifeTotRes, lifeDepRes] = await Promise.allSettled([
      laneReach(ids),
      (async () => {
        const out = new Map<string, number>();
        for (let i = 0; i < families.length; i += 8) {
          await Promise.all(
            families.slice(i, i + 8).map(async (f) => {
              const r = await laneReach(f.campaignIds);
              out.set(f.key, r?.members ?? 0);
            }),
          );
        }
        return out;
      })(),
      (async () => {
        const { data, error } = await supabaseAdmin.rpc("audience_lane_deposits", {
          p_campaign_ids: ids,
          p_from: new Date(startMs).toISOString(),
          p_to: new Date(endMs).toISOString(),
        });
        if (error) throw new Error(error.message);
        return ((data ?? []) as { day: string; deposits: number; players: number; amount_eur: number | string; deposits_before: number }[]).map((d) => ({
          day: d.day,
          deposits: d.deposits,
          players: d.players,
          amountEur: Number(d.amount_eur) || 0,
          depositsBefore: d.deposits_before,
        }));
      })(),
      (async () => {
        const one = async (col: string, asc: boolean, captured: boolean) => {
          let q = supabaseAdmin.from("cio_events").select(col).eq("event_name", "deposit_made");
          q = captured ? q.eq("payload->>source", CAPTURE_SOURCE) : q.filter("payload->>source", "is", null);
          const { data, error } = await q.order(col, { ascending: asc }).limit(1);
          if (error) throw new Error(error.message);
          const row = (data as unknown as Record<string, string>[] | null)?.[0];
          return row ? row[col] : null;
        };
        const [captureFrom, captureTo, liveFrom] = await Promise.all([one("occurred_at", true, true), one("occurred_at", false, true), one("received_at", true, false)]);
        return { captureFrom, captureTo, liveFrom };
      })(),
      totalsRpc(new Date(startMs).toISOString(), new Date(endMs).toISOString()),
      depositorsRpc(new Date(startMs).toISOString(), new Date(endMs).toISOString()),
      totalsRpc(EPOCH, nowIso),
      depositorsRpc(EPOCH, nowIso),
    ]);

    let reach: LaneReach | null = null;
    if (reachRes.status === "fulfilled") reach = reachRes.value;
    else unavailable.reach = reachRes.reason instanceof Error ? reachRes.reason.message : String(reachRes.reason);
    const deposited: LifetimeDeposited | null =
      lifeTotRes.status === "fulfilled" && lifeDepRes.status === "fulfilled" ? { players: lifeDepRes.value, totals: lifeTotRes.value } : null;
    if (famRes.status === "fulfilled") for (const f of families) f.members = famRes.value.get(f.key) ?? null;
    else unavailable.families = famRes.reason instanceof Error ? famRes.reason.message : String(famRes.reason);
    let deposits: AudienceDeposits | null = null;
    if (depRes.status === "fulfilled" && covRes.status === "fulfilled") {
      deposits = {
        from: new Date(startMs).toISOString(),
        to: new Date(endMs).toISOString(),
        days: depRes.value,
        coverage: covRes.value,
        totals: totRes.status === "fulfilled" ? totRes.value : null,
        depositors: depositorsRes.status === "fulfilled" ? depositorsRes.value : null,
      };
      if (totRes.status === "rejected") unavailable.deposits = totRes.reason instanceof Error ? totRes.reason.message : String(totRes.reason);
    } else {
      const why = depRes.status === "rejected" ? depRes.reason : covRes.status === "rejected" ? covRes.reason : null;
      unavailable.deposits = why instanceof Error ? why.message : String(why);
    }

    return NextResponse.json({ scopeCampaigns: ids.length, reach, deposited, families, deposits, unavailable } satisfies AudienceReachResponse);
  } catch (err) {
    console.error("[audience/reach] failed:", err);
    return NextResponse.json({ error: "Failed to load audience reach" }, { status: 500 });
  }
}
