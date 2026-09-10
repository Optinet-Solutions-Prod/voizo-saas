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
/** Players who deposited after contact, LIFETIME, on the Reach card's own denominator (players ever
 *  loaded), with the gross per currency beside them. null when either function is unavailable. */
export interface LifetimeDeposited {
  players: number;
  totals: DepositTotal[];
}
/** What Voizo DID in the window and what followed (Jasiel 2026-09-08). Counts of players, no
 *  comparison group and no claim about cause: the contacted cohort is selected (reactivation and new
 *  registrations) and its deposit exposure is shorter than the window, so any side-by-side rate
 *  would mislead. `depositors` are contacted players who deposited at or after their FIRST touch in
 *  the window. Replaces the last-touch bucket card; cause is a holdout question. */
export interface ContactWindow {
  contacted: number;
  spoke: number;
  texted: number;
  delivered: number;
  depositors: number;
  amountEur: number;
}
export interface AudienceReachResponse {
  scopeCampaigns: number;
  reach: LaneReach | null;
  /** All-time deposits after contact, for the Reach card. Filter-independent by definition, so it
   *  stays here; the WINDOW deposits moved to /api/audience/deposits (2026-09-10). */
  deposited: LifetimeDeposited | null;
  families: AudienceFamily[];
  contactWindow: ContactWindow | null;
  unavailable: { reach?: string; families?: string; contactWindow?: string };
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
      return NextResponse.json({ scopeCampaigns: 0, reach: null, deposited: null, families: [], contactWindow: null, unavailable } satisfies AudienceReachResponse);
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
    // The WINDOW deposits (per day, per currency, the depositor count and the coverage) moved to
    // /api/audience/deposits on 2026-09-10, because the money strip now follows the Depositors
    // table's filters and this route cannot see them. Leaving the old block here fired the same
    // heavy work twice on every page load: with four concurrent requests the players RPC crossed
    // the 8 s statement limit and 3 of 5 loads 500'd. Only the LIFETIME pair stays, for the Reach
    // card's Deposited row, which is filter-independent by definition.
    const [reachRes, famRes, lifeTotRes, lifeDepRes, workRes] = await Promise.allSettled([
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
      totalsRpc(EPOCH, nowIso),
      depositorsRpc(EPOCH, nowIso),
      (async () => {
        const { data, error } = await supabaseAdmin.rpc("audience_lane_contact_window", {
          p_campaign_ids: ids,
          p_from: new Date(startMs).toISOString(),
          p_to: new Date(endMs).toISOString(),
        });
        if (error) throw new Error(error.message);
        const r = ((data ?? []) as { contacted: number; spoke: number; texted: number; delivered: number; depositors: number; amount_eur: number | string }[])[0];
        if (!r) return null;
        return {
          contacted: Number(r.contacted) || 0,
          spoke: Number(r.spoke) || 0,
          texted: Number(r.texted) || 0,
          delivered: Number(r.delivered) || 0,
          depositors: Number(r.depositors) || 0,
          amountEur: Number(r.amount_eur) || 0,
        } satisfies ContactWindow;
      })(),
    ]);

    let reach: LaneReach | null = null;
    if (reachRes.status === "fulfilled") reach = reachRes.value;
    else unavailable.reach = reachRes.reason instanceof Error ? reachRes.reason.message : String(reachRes.reason);
    const deposited: LifetimeDeposited | null =
      lifeTotRes.status === "fulfilled" && lifeDepRes.status === "fulfilled" ? { players: lifeDepRes.value, totals: lifeTotRes.value } : null;
    if (famRes.status === "fulfilled") for (const f of families) f.members = famRes.value.get(f.key) ?? null;
    else unavailable.families = famRes.reason instanceof Error ? famRes.reason.message : String(famRes.reason);
    let contactWindow: ContactWindow | null = null;
    if (workRes.status === "fulfilled") contactWindow = workRes.value;
    else unavailable.contactWindow = workRes.reason instanceof Error ? workRes.reason.message : String(workRes.reason);

    return NextResponse.json({ scopeCampaigns: ids.length, reach, deposited, families, contactWindow, unavailable } satisfies AudienceReachResponse);
  } catch (err) {
    console.error("[audience/reach] failed:", err);
    return NextResponse.json({ error: "Failed to load audience reach" }, { status: 500 });
  }
}
