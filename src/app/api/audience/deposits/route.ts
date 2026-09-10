import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseServer";
import { fetchAllRows } from "@/lib/supabaseFetchAll";
import { rangeToWindow } from "@/lib/rangeWindow";
import { familyKeyOf, laneCampaignIds, type FamilyCampaign } from "@/lib/audienceLane";
import { loadDeposits, loadReachWindow, type LaneReachWindow } from "@/lib/audienceDeposits";
import type { AudienceDeposits } from "../reach/route";

/**
 * GET /api/audience/deposits?brand=&country=&range=|from=&to=&deposited=&contact=&family=&q=
 *
 * Everything on the Audience tab that follows the WINDOW and the Depositors table's FILTERS: the
 * money strip with its Deposits-by-day chart (Jasiel 2026-09-10), and since 2026-09-11 the merged
 * Reach card. Scope, window, family and search are parsed EXACTLY as /api/audience/players parses
 * them, so "Spoke with them" or a family name means the same players above the line as below it.
 *
 * Both blocks ride ONE request on purpose. They are the two things that must never disagree about
 * who they are describing, and the page defers this request behind the players query so the three
 * heavy statements do not land together (2026-09-10, 20:10 UTC: four at once put the players
 * statement over the 8 s limit and the table 500'd on three loads out of five). They still FAIL
 * INDEPENDENTLY: `unavailable` carries the strip's reason, `unavailableReach` the card's, each card
 * says "Not available yet" naming its paste, and the rest of the page stands.
 *
 * Read-only, lenient origin (GET), Basic Auth via middleware.
 */
const DEPOSITED = new Set(["any", "after", "before", "none", "unknown"]);
const CONTACT = new Set(["any", "reached", "spoke", "never_spoke", "texted", "delivered", "never"]);

export interface AudienceDepositsResponse {
  scopeCampaigns: number;
  deposits: AudienceDeposits | null;
  /** The merged Reach card's row, on the same population as the strip. */
  reach: LaneReachWindow | null;
  /** The resolved window, at the TOP level: the card names its window in the header, and it must
   *  still be able to when the strip block is the one that failed. */
  from: string;
  to: string;
  unavailable?: string;
  unavailableReach?: string;
}

type Camp = FamilyCampaign & { source: string | null; is_test: boolean | null };

const pick = (raw: string | null, allowed: Set<string>, fallback: string) => (raw && allowed.has(raw) ? raw : fallback);
const dayIso = (s: string | null) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : "");

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
  const deposited = pick(sp.get("deposited"), DEPOSITED, "any");
  const contact = pick(sp.get("contact"), CONTACT, "any");
  const familyKey = (sp.get("family") ?? "").trim().slice(0, 120);
  const q = (sp.get("q") ?? "").trim().slice(0, 60).replace(/[%_\\]/g, "");
  const from = dayIso(sp.get("from")), to = dayIso(sp.get("to"));
  const range = (sp.get("range") ?? "").trim().slice(0, 12);
  const { startMs, endMs } = from && to ? rangeToWindow("custom", Date.now(), from, to) : rangeToWindow(range || "14d", Date.now());
  const fromIso0 = new Date(startMs).toISOString(), toIso0 = new Date(endMs).toISOString();

  try {
    const campaigns = (await fetchAllRows(
      supabaseAdmin,
      "campaigns_v2",
      "id, name, cio_workspace, source, is_test, parent_campaign_id, campaign_type, start_at",
      "id",
    )) as unknown as Camp[];
    const live = campaigns.filter((c) => c.source !== "ghost_portal" && c.is_test !== true);
    const laneIds = laneCampaignIds(live, brand, country);
    const ids = [...laneIds];
    if (ids.length === 0) return NextResponse.json({ scopeCampaigns: 0, deposits: null, reach: null, from: fromIso0, to: toIso0 } satisfies AudienceDepositsResponse);
    // A family filter arrives as a key and leaves as campaign ids, resolved with the tab's own rule,
    // the same line the players route uses. An unknown key resolves to an empty family, which the
    // function reads as "no player", never as "every player".
    const familyIds = familyKey ? live.filter((c) => laneIds.has(c.id) && familyKeyOf(c) === familyKey).map((c) => c.id) : null;

    const filters = { deposited, contact, familyIds, q: q || null };
    // Settled, not all: one block missing its function must not blank the other.
    const [depRes, reachRes] = await Promise.allSettled([
      loadDeposits(supabaseAdmin, ids, fromIso0, toIso0, filters),
      loadReachWindow(supabaseAdmin, ids, fromIso0, toIso0, filters),
    ]);
    // A function not yet applied is the expected first failure: name the file, not a bare code.
    const why = (r: PromiseRejectedResult, fn: string, file: string) => {
      const m = r.reason instanceof Error ? r.reason.message : String(r.reason);
      return new RegExp(fn).test(m) ? `${m} — apply ${file}` : m;
    };
    return NextResponse.json({
      scopeCampaigns: ids.length,
      from: fromIso0,
      to: toIso0,
      deposits: depRes.status === "fulfilled" ? depRes.value : null,
      reach: reachRes.status === "fulfilled" ? reachRes.value : null,
      ...(depRes.status === "rejected" ? { unavailable: why(depRes, "audience_lane_deposit_rollup", "2026-09-10_audience_lane_deposit_rollup_rpc.sql") } : {}),
      ...(reachRes.status === "rejected" ? { unavailableReach: why(reachRes, "audience_lane_reach_window", "2026-09-11_audience_lane_reach_window_rpc.sql") } : {}),
    } satisfies AudienceDepositsResponse);
  } catch (err) {
    console.error("[audience/deposits] failed:", err);
    return NextResponse.json({ error: "Failed to load deposits" }, { status: 500 });
  }
}
