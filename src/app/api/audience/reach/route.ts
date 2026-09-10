import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseServer";
import { fetchAllRows } from "@/lib/supabaseFetchAll";
import { parseCountryToken } from "@/lib/campaignAnalytics";
import { deriveDisplayStatus, type DisplayStatus } from "@/lib/dashboardAnalytics";
import { campaignLabeller, familyKeyOf, laneCampaignIds, type FamilyCampaign } from "@/lib/audienceLane";

/**
 * GET /api/audience/reach?brand=&country=&range=
 *
 * The Audience tab's aggregate blocks (mockup 2026-08-25, slices 2, 3 and 5 of the wire), one
 * request: the Members tile and the Reach card (audience_lane_reach, plus the all-time deposited
 * pair), and the campaign families with their run and member counts (the same RPC per family).
 * Every headline here is a count of DISTINCT PLAYERS, which nothing in the database answered until
 * those functions existed; see the migration files at the repo root for the definitions, which are
 * copied from the dashboard's rollup, not invented.
 *
 * The WINDOW deposits (Deposits by day, the money strip, the depositor count and the coverage) left
 * this route on 2026-09-10 for /api/audience/deposits, because they now follow the Depositors
 * table's filters and this route does not see them. Everything here is filter-independent.
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
export interface AudienceReachResponse {
  scopeCampaigns: number;
  reach: LaneReach | null;
  families: AudienceFamily[];
  unavailable: { reach?: string; families?: string };
}

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
  // No window is read here any more: every windowed block moved to /api/audience/deposits. The
  // page still sends range/from/to on this request; they are simply ignored.

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
      return NextResponse.json({ scopeCampaigns: 0, reach: null, families: [], unavailable } satisfies AudienceReachResponse);
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

    // ── The two remaining blocks, independently. The Reach card, the money strip and the window
    // deposits all moved to /api/audience/deposits, which follows the Depositors table's filters;
    // this route now answers only what is filter-independent: the Members tile and the families.
    const [reachRes, famRes] = await Promise.allSettled([
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
    ]);

    let reach: LaneReach | null = null;
    if (reachRes.status === "fulfilled") reach = reachRes.value;
    else unavailable.reach = reachRes.reason instanceof Error ? reachRes.reason.message : String(reachRes.reason);
    if (famRes.status === "fulfilled") for (const f of families) f.members = famRes.value.get(f.key) ?? null;
    else unavailable.families = famRes.reason instanceof Error ? famRes.reason.message : String(famRes.reason);

    return NextResponse.json({ scopeCampaigns: ids.length, reach, families, unavailable } satisfies AudienceReachResponse);
  } catch (err) {
    console.error("[audience/reach] failed:", err);
    return NextResponse.json({ error: "Failed to load audience reach" }, { status: 500 });
  }
}
