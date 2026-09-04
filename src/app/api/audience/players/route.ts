import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseServer";
import { fetchAllRows, fetchRowsIn } from "@/lib/supabaseFetchAll";
import { deriveAttemptTag, isSmsSent, type DashCallRow, type AttemptTag } from "@/lib/dashboardAnalytics";
import { brandKey, brandLabel, campaignGroupHeaderLabels, campaignIdsForCountry, campaignShortLabel, formatCampaign } from "@/lib/campaignDisplay";
import { parseCountryToken } from "@/lib/campaignAnalytics";
// Relative on purpose: the same helper the Today rows use, and "@/" does not resolve under vitest.
import { playOf } from "../../../analytics/campaignGrouping";

/**
 * GET /api/audience/players?brand=&country=&limit=
 *
 * The Audience tab's "Player activity" list (mockup 2026-08-25, slice 4 of the wire): the players
 * most recently contacted in the lane, one row per PHONE, with the outcome of their last calls as
 * dots. Bounded by design: `limit` players (100 default, 200 cap), found by walking the newest
 * calls in scope, so the cost is fixed whatever the lane's size.
 *
 * Lane scope is the DASHBOARD's rule, resolved here with the same two helpers the analytics route
 * uses (brandKey on cio_workspace, the country parsed from the campaign name). The snapshot
 * engine behind /audience/preview groups by FAMILY instead, and the two sets differ (measured
 * 2026-09-04: L7|AU texted 2,946 vs the preview's 3,211). Whichever Jasiel picks, it changes in
 * ONE place: laneCampaignIds() below.
 *
 * Dots are the LEAN attempt tag (no transcript): unreachable → never, voicemail → voicemail,
 * early_hangup → silent, everything else that connected → spoke. The lean rule cannot emit
 * silent_pickup (it needs user-turn counts), so a dead-air pickup reads "spoke" here where the
 * transcript path would say "silent". Same divergence the records drawer already documents.
 *
 * Read-only, lenient origin (GET), Basic Auth via middleware. No transcript in the response.
 */
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 200;
// Newest calls to walk to find `limit` distinct phones. A player has ~1.5 calls in a lane on
// average and a phone can hold several numbers, so 6x is generous; if a lane's newest calls are
// unusually concentrated on few players the list simply comes back shorter, and says so.
const CALL_WALK_FACTOR = 6;
const DOTS = 3;

export type Dot = "spoke" | "silent" | "voicemail" | "never";
const DOT_OF: Record<AttemptTag, Dot> = {
  positive: "spoke", neutral: "spoke", declined: "spoke", agent_timeout: "spoke",
  silent_pickup: "silent", early_hangup: "silent",
  voicemail: "voicemail", unreachable: "never",
};

export interface PlayerEvent {
  at: string;
  kind: "call" | "sms";
  /** call: the lean attempt tag; sms: the delivery status. */
  what: string;
  durationSeconds?: number | null;
}
export interface AudiencePlayerRow {
  phone: string;
  name: string | null;
  /** The market TOKEN of the latest run ("AU"), as the mockup's Market column reads. */
  market: string;
  /** The FAMILY the player was last in (the mockup's Campaign column), app-labelled. */
  campaignId: string;
  campaignLabel: string;
  /** Other families the same phone sat in within the lane: the mockup's "also in ...". */
  alsoIn: string[];
  numberId: string;
  /** Newest first, at most DOTS entries. */
  dots: Dot[];
  calls: number;
  smsSent: boolean;
  smsDelivered: number;
  firstAt: string | null;
  lastAt: string | null;
  /** The drawer's timeline: newest first, the last 6 calls and last 3 texts. */
  events: PlayerEvent[];
  /** Every (campaign, number) this phone sat in within the lane, newest first: the drawer's runs. */
  runs: { numberId: string; campaignId: string; campaignLabel: string; lastAt: string | null; outcome: string | null; attempts: number }[];
}

export function laneCampaignIds(
  live: { id: string; name: string | null; cio_workspace?: string | null }[],
  brand: string,
  country: string,
): Set<string> {
  const byBrand = brand ? live.filter((c) => brandKey(c.cio_workspace) === brand) : live;
  return country ? campaignIdsForCountry(byBrand, country) : new Set(byBrand.map((c) => c.id));
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
  const limit = Math.min(MAX_LIMIT, Math.max(1, Math.trunc(Number(sp.get("limit")) || DEFAULT_LIMIT)));

  try {
    const campaigns = (await fetchAllRows(
      supabaseAdmin,
      "campaigns_v2",
      // parent_campaign_id + campaign_type: the family a run belongs to, so the Campaign column
      // names the FAMILY (the mockup) with the same label Campaign Performance uses. The today
      // route once omitted parent_campaign_id and every lane label silently fell back to raw names.
      "id, name, cio_workspace, source, is_test, parent_campaign_id, campaign_type, start_at",
      "id",
    )) as unknown as { id: string; name: string | null; cio_workspace: string | null; source: string | null; is_test: boolean | null; parent_campaign_id: string | null; campaign_type: string | null; start_at: string | null }[];
    const live = campaigns.filter((c) => c.source !== "ghost_portal" && c.is_test !== true);
    const ids = [...laneCampaignIds(live, brand, country)];
    const labelOf = new Map(live.map((c) => [c.id, c]));
    if (ids.length === 0) return NextResponse.json({ rows: [], scopeCampaigns: 0, limit });

    // Newest calls in scope → the phones behind them, until `limit` distinct phones.
    const walk = await fetchRowsIn(
      supabaseAdmin,
      "calls_v2",
      "campaign_number_id, created_at",
      "campaign_id",
      ids,
      (q) => q.order("created_at", { ascending: false }).limit(limit * CALL_WALK_FACTOR),
    ) as unknown as { campaign_number_id: string | null; created_at: string }[];
    // fetchRowsIn chunks the IN, so merge-sort the chunks by time before walking.
    walk.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
    const seenNumbers = new Set<string>();
    const walkNumberIds: string[] = [];
    for (const w of walk) {
      if (w.campaign_number_id && !seenNumbers.has(w.campaign_number_id)) {
        seenNumbers.add(w.campaign_number_id);
        walkNumberIds.push(w.campaign_number_id);
      }
    }
    if (walkNumberIds.length === 0) return NextResponse.json({ rows: [], scopeCampaigns: ids.length, limit });

    // The numbers behind those calls → their phones. Then EVERY number those phones hold in the
    // lane, so a player's dots and runs cover all their campaigns, not just the one just dialled.
    const walkNums = (await fetchRowsIn(supabaseAdmin, "campaign_numbers_v2", "id, phone_e164", "id", walkNumberIds)) as unknown as { id: string; phone_e164: string | null }[];
    const phoneOrder: string[] = [];
    const phoneSeen = new Set<string>();
    const phoneOfWalk = new Map(walkNums.map((n) => [n.id, n.phone_e164]));
    for (const nid of walkNumberIds) {
      const ph = phoneOfWalk.get(nid);
      if (ph && !phoneSeen.has(ph)) { phoneSeen.add(ph); phoneOrder.push(ph); }
      if (phoneOrder.length >= limit) break;
    }
    const nums = await fetchRowsIn(
      supabaseAdmin,
      "campaign_numbers_v2",
      "id, campaign_id, phone_e164, display_name, outcome, attempt_count, last_attempted_at",
      "phone_e164",
      phoneOrder,
      (q) => q.in("campaign_id", ids),
    ) as unknown as { id: string; campaign_id: string; phone_e164: string; display_name: string | null; outcome: string | null; attempt_count: number | null; last_attempted_at: string | null }[];
    const numIds = nums.map((n) => n.id);

    const [calls, sms] = await Promise.all([
      fetchRowsIn(
        supabaseAdmin,
        "calls_v2",
        "id, campaign_id, campaign_number_id, status, goal_reached, created_at, voicemail, duration_seconds, ended_reason",
        "campaign_number_id",
        numIds,
      ) as unknown as Promise<DashCallRow[]>,
      fetchRowsIn(supabaseAdmin, "sms_messages_v2", "campaign_number_id, status, created_at", "campaign_number_id", numIds) as unknown as Promise<{ campaign_number_id: string; status: string; created_at: string }[]>,
    ]);

    const declined = new Set(nums.filter((n) => (n.outcome ?? "") === "declined_offer").map((n) => n.id));
    const smsSentNumbers = new Set(sms.filter((m) => isSmsSent(m.status)).map((m) => m.campaign_number_id));
    const smsByNumber = new Map<string, { campaign_number_id: string; status: string; created_at: string }[]>();
    for (const m of sms) {
      const g = smsByNumber.get(m.campaign_number_id);
      if (g) g.push(m); else smsByNumber.set(m.campaign_number_id, [m]);
    }
    const numById = new Map(nums.map((n) => [n.id, n]));
    const byPhone = new Map<string, typeof nums>();
    for (const n of nums) {
      const g = byPhone.get(n.phone_e164);
      if (g) g.push(n); else byPhone.set(n.phone_e164, [n]);
    }
    const callsByPhone = new Map<string, DashCallRow[]>();
    for (const c of calls) {
      const n = c.campaign_number_id ? numById.get(c.campaign_number_id) : undefined;
      if (!n) continue;
      const g = callsByPhone.get(n.phone_e164);
      if (g) g.push(c); else callsByPhone.set(n.phone_e164, [c]);
    }
    // The Campaign column names the FAMILY (the mockup's rule), with the label Campaign Performance
    // gives that family, minus the country (the tab states it) and minus the brand unless All
    // brands is in view. A run with no family is named from itself the same way.
    const parentLabels = campaignGroupHeaderLabels(
      live.filter((c) => c.campaign_type === "recurring").map((c) => ({ id: c.id, name: c.name ?? "", brand: c.cio_workspace, startAt: c.start_at })),
    );
    const familyOf = (campaignId: string): string => labelOf.get(campaignId)?.parent_campaign_id ?? campaignId;
    const label = (campaignId: string): string => {
      const c = labelOf.get(campaignId);
      if (!c) return campaignId.slice(0, 8);
      const b = brandLabel(c.cio_workspace);
      const fam = c.parent_campaign_id ? parentLabels.get(c.parent_campaign_id) : undefined;
      // The date stamp goes: "Last contact" carries the date, and it sat after the brand segment,
      // which stopped playOf from stripping the brand ("… · Fortune Play (2026-09-04)").
      const short = fam ?? campaignShortLabel(c.name).replace(/\s*\(\d{4}-\d{2}-\d{2}\)\s*$/, "");
      const play = playOf(short, formatCampaign(c.name).country, b) || short;
      return brand ? play : `${b} · ${play}`;
    };

    const rows: AudiencePlayerRow[] = [];
    for (const ph of phoneOrder) {
      const group = byPhone.get(ph);
      if (!group) continue;
      const cs = (callsByPhone.get(ph) ?? []).sort((a, b) => ((a.created_at ?? "") < (b.created_at ?? "") ? 1 : -1));
      const latestCall = cs[0];
      const latestNum = latestCall?.campaign_number_id ? numById.get(latestCall.campaign_number_id) : undefined;
      const lead = latestNum ?? group[0];
      const tagged = cs.map((c) => ({ c, tag: deriveAttemptTag(c, declined.has(c.campaign_number_id ?? ""), { useTranscript: false }) }));
      const dots = tagged.slice(0, DOTS).map((x) => DOT_OF[x.tag]);
      const phoneSms = group.flatMap((n) => smsByNumber.get(n.id) ?? []).sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
      const events: PlayerEvent[] = [
        ...tagged.slice(0, 6).map((x) => ({ at: x.c.created_at ?? "", kind: "call" as const, what: x.tag, durationSeconds: x.c.duration_seconds ?? null })),
        ...phoneSms.slice(0, 3).map((m) => ({ at: m.created_at, kind: "sms" as const, what: m.status })),
      ].filter((e) => e.at).sort((a, b) => (a.at < b.at ? 1 : -1));
      const firstAt = [...cs.map((c) => c.created_at ?? ""), ...phoneSms.map((m) => m.created_at)].filter(Boolean).sort()[0] ?? null;
      const families = [...new Set(group.map((n) => familyOf(n.campaign_id)))];
      const runs = group
        .map((n) => ({
          numberId: n.id,
          campaignId: n.campaign_id,
          campaignLabel: label(n.campaign_id),
          lastAt: n.last_attempted_at,
          outcome: n.outcome,
          attempts: n.attempt_count ?? 0,
        }))
        .sort((a, b) => ((a.lastAt ?? "") < (b.lastAt ?? "") ? 1 : -1));
      rows.push({
        phone: ph,
        name: group.find((n) => n.display_name)?.display_name ?? null,
        market: parseCountryToken(labelOf.get(lead.campaign_id)?.name ?? "") || "",
        campaignId: lead.campaign_id,
        campaignLabel: label(lead.campaign_id),
        alsoIn: families.filter((f) => f !== familyOf(lead.campaign_id)).map((f) => {
          const anyRun = group.find((n) => familyOf(n.campaign_id) === f);
          return anyRun ? label(anyRun.campaign_id) : f.slice(0, 8);
        }),
        numberId: lead.id,
        dots,
        calls: cs.length,
        smsSent: group.some((n) => smsSentNumbers.has(n.id)),
        smsDelivered: phoneSms.filter((m) => m.status === "delivered").length,
        firstAt,
        lastAt: latestCall?.created_at ?? lead.last_attempted_at ?? null,
        events,
        runs,
      });
    }
    return NextResponse.json({ rows, scopeCampaigns: ids.length, limit });
  } catch (err) {
    console.error("[audience/players] failed:", err);
    return NextResponse.json({ error: "Failed to load players" }, { status: 500 });
  }
}
