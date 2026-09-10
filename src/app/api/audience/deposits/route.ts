import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseServer";
import { fetchAllRows } from "@/lib/supabaseFetchAll";
import { rangeToWindow } from "@/lib/rangeWindow";
import { familyKeyOf, laneCampaignIds, type FamilyCampaign } from "@/lib/audienceLane";
import { loadDeposits } from "@/lib/audienceDeposits";
import type { AudienceDeposits } from "../reach/route";

/**
 * GET /api/audience/deposits?brand=&country=&range=|from=&to=&deposited=&contact=&family=&q=
 *
 * The money strip and the Deposits-by-day chart, following the Depositors table's filters (Jasiel
 * 2026-09-10). Scope, window, family and search are parsed EXACTLY as /api/audience/players parses
 * them, so "Spoke with them" or a family name means the same players above the line as below it.
 *
 * Unavailable (the function not yet applied, a timeout) comes back as `unavailable` with the reason,
 * and the card says "Not available yet" naming the paste; the rest of the page stands.
 *
 * Read-only, lenient origin (GET), Basic Auth via middleware.
 */
const DEPOSITED = new Set(["any", "after", "before", "none", "unknown"]);
const CONTACT = new Set(["any", "reached", "spoke", "never_spoke", "texted", "delivered", "never"]);

export interface AudienceDepositsResponse {
  scopeCampaigns: number;
  deposits: AudienceDeposits | null;
  unavailable?: string;
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
    if (ids.length === 0) return NextResponse.json({ scopeCampaigns: 0, deposits: null } satisfies AudienceDepositsResponse);
    // A family filter arrives as a key and leaves as campaign ids, resolved with the tab's own rule,
    // the same line the players route uses. An unknown key resolves to an empty family, which the
    // function reads as "no player", never as "every player".
    const familyIds = familyKey ? live.filter((c) => laneIds.has(c.id) && familyKeyOf(c) === familyKey).map((c) => c.id) : null;

    try {
      const deposits = await loadDeposits(supabaseAdmin, ids, new Date(startMs).toISOString(), new Date(endMs).toISOString(), {
        deposited,
        contact,
        familyIds,
        q: q || null,
      });
      return NextResponse.json({ scopeCampaigns: ids.length, deposits } satisfies AudienceDepositsResponse);
    } catch (e) {
      const why = e instanceof Error ? e.message : String(e);
      // The function missing is the expected first failure: name the file rather than a bare code.
      const hint = /audience_lane_deposit_rollup/.test(why) ? `${why} — apply 2026-09-10_audience_lane_deposit_rollup_rpc.sql` : why;
      return NextResponse.json({ scopeCampaigns: ids.length, deposits: null, unavailable: hint } satisfies AudienceDepositsResponse);
    }
  } catch (err) {
    console.error("[audience/deposits] failed:", err);
    return NextResponse.json({ error: "Failed to load deposits" }, { status: 500 });
  }
}
