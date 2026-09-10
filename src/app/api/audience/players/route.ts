import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseServer";
import { fetchAllRows, fetchRowsIn } from "@/lib/supabaseFetchAll";
import { deriveAttemptTag, isSmsSent, type DashCallRow } from "@/lib/dashboardAnalytics";
import { parseCountryToken } from "@/lib/campaignAnalytics";
import { brandKey, brandLabel } from "@/lib/campaignDisplay";
import { rangeToWindow } from "@/lib/rangeWindow";
import { csvCell, CSV_BOM } from "@/lib/download";
import { campaignLabeller, familyKeyOf, laneCampaignIds, DOT_OF, type Dot, type FamilyCampaign } from "@/lib/audienceLane";

/**
 * GET /api/audience/players?brand=&country=&from=&to=&range=&deposited=&contact=&family=&q=&sort=&page=
 * GET …&format=csv                                      the whole filtered set as a CSV file
 *
 * The Audience tab's "Player activity" list (mockup 2026-08-25; Jasiel 2026-09-07: "groups of players
 * who deposited, were contacted, in a window, in a campaign"). Since 2026-09-07 the list is a real
 * QUERY over the whole lane, not a sample: audience_lane_players() computes one row per PLAYER (phone)
 * in the database, applies the filters, sorts and pages, and returns the true filtered total. This
 * route resolves the lane and the family with the tab's own rules (lib/audienceLane.ts), calls the
 * function for one page, then enriches those 25 players with what the table and the drawer draw:
 * the last calls as dots, the timeline, the runs, the deposits.
 *
 * FILTERS (see the SQL file for the exact rules):
 *   deposited  any | after | before | none | unknown       contact  any | reached | texted | delivered | never
 *   family     a family key from /api/audience/reach       q        phone or name contains
 *   sort       last_contact | first_contact | last_deposit | first_deposit | amount | lag | calls | phone
 *   dir        desc (default) | asc                      page     1-based, 25 per page
 * THE WINDOW is the event the filter is about: deposit dates under deposited=after, last contact
 * otherwise. `from`/`to` are YYYY-MM-DD (to inclusive); `range=lifetime` with no dates = all time.
 *
 * Deposits come from cio_events joined on (workspace, cio_id) through BOTH bridges
 * (campaign_numbers_v2.cio_id, realtime_seen_members under a same-brand parent); "after contact" = at
 * or after the player's first call or text in the lane; each CRM identity belongs to one phone.
 * Dots are the LEAN attempt tag (no transcript): a dead-air pickup reads "spoke" here where the
 * transcript path would say "silent"; the records drawer documents the same gap.
 *
 * Read-only, lenient origin (GET), Basic Auth via middleware. No transcript in the response.
 */
const PAGE_SIZE = 25;
const CSV_CAP = 20_000;
// PostgREST clamps any response at 1,000 rows, an RPC's included (measured 2026-09-07: a 2,569-row
// call came back with 1,000 and the right total). The export pages the function in that step.
const RPC_PAGE = 1_000;
const DOTS = 3;
const DEPOSITED = new Set(["any", "after", "before", "none", "unknown"]);
const CONTACT = new Set(["any", "reached", "spoke", "never_spoke", "texted", "delivered", "never"]);
const SORT = new Set(["last_contact", "first_contact", "last_deposit", "first_deposit", "amount", "lag", "calls", "phone"]);
const DIR = new Set(["asc", "desc"]);

export type { Dot };
export type Deposited = "any" | "after" | "before" | "none" | "unknown";
export type Contact = "any" | "reached" | "spoke" | "never_spoke" | "texted" | "delivered" | "never";
export type PlayerSort = "last_contact" | "first_contact" | "last_deposit" | "first_deposit" | "amount" | "lag" | "calls" | "phone";
export type SortDir = "asc" | "desc";

export interface PlayerEvent {
  at: string;
  kind: "call" | "sms" | "dep";
  /** call: the lean attempt tag; sms: the delivery status; dep: "<currency> <amount>". */
  what: string;
  durationSeconds?: number | null;
}
export interface PlayerDeposit {
  at: string;
  currency: string | null;
  amountLocal: number | null;
  amountEur: number | null;
  /** At or after the player's first contact in the lane. */
  afterContact: boolean;
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
  reached: boolean;
  /** The strict rule (VOZ-511): somebody actually spoke on the call. `reached` is the older,
   *  looser one, which counts a line that answered in silence and a four-second hang-up. */
  spokeWith: boolean;
  smsSent: boolean;
  smsDelivered: number;
  firstAt: string | null;
  lastAt: string | null;
  /** The drawer's timeline: newest first, the last 6 calls, last 3 texts and last 4 deposits. */
  events: PlayerEvent[];
  /** Every (campaign, number) this phone sat in within the lane, newest first: the drawer's runs. */
  runs: { numberId: string; campaignId: string; campaignLabel: string; lastAt: string | null; outcome: string | null; attempts: number }[];
  /** Whether we hold a CRM identity for this player at all. false = "no record", not "none". */
  cioKnown: boolean;
  /** The CRM identities behind the player, for the drawer's live Customer.io lookup. */
  cio: { workspace: string; cioId: string }[];
  /** Newest first. Empty with cioKnown = no deposit on record. */
  deposits: PlayerDeposit[];
}
export interface AudiencePlayersResponse {
  rows: AudiencePlayerRow[];
  total: number;
  page: number;
  pageSize: number;
  scopeCampaigns: number;
}

type Camp = FamilyCampaign & { source: string | null; is_test: boolean | null };
type Num = { id: string; campaign_id: string; phone_e164: string; display_name: string | null; outcome: string | null; attempt_count: number | null; last_attempted_at: string | null; cio_id: string | null };
type Sms = { campaign_number_id: string; status: string; created_at: string };
type Seen = { phone_e164: string; cio_id: string; parent_campaign_id: string };
type CioDeposit = { workspace: string; cio_id: string; occurred_at: string; currency: string | null; amount_local: string | null; amount_norm: number | string | null };
type RpcRow = {
  phone_e164: string; display_name: string | null; last_campaign_id: string | null; first_at: string | null; last_at: string | null;
  calls: number; reached: boolean; spoke_with?: boolean; texted: boolean; delivered: boolean; cio_known: boolean;
  dep_after: number; dep_after_eur: number | string; dep_before: number; first_dep_after_at: string | null; last_dep_at: string | null;
  dep_after_in_window: number; dep_after_in_window_eur: number | string; total_count: number | string;
};

const pick = <T extends string>(v: string | null, allowed: Set<string>, fallback: T): T => (v && allowed.has(v) ? (v as T) : fallback);
const dayIso = (s: string | null) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null);

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
  const deposited = pick<Deposited>(sp.get("deposited"), DEPOSITED, "any");
  const contact = pick<Contact>(sp.get("contact"), CONTACT, "any");
  // Maria's attribution window (27 Aug): count a deposit as "after contact" only when it lands
  // within this many days of the player's first contact. 0 keeps the old behaviour, any time after.
  // Clamped to a year so a typo cannot turn into an unbounded interval in the query.
  const attribDays = Math.min(365, Math.max(0, Math.trunc(Number(sp.get("attribDays")) || 0)));
  const sort = pick<PlayerSort>(sp.get("sort"), SORT, "last_contact");
  const dir = pick<SortDir>(sp.get("dir"), DIR, "desc");
  const familyKey = (sp.get("family") ?? "").trim().slice(0, 120);
  const q = (sp.get("q") ?? "").trim().slice(0, 60).replace(/[%_\\]/g, "");
  const page = Math.max(1, Math.trunc(Number(sp.get("page")) || 1));
  const csv = sp.get("format") === "csv";
  const from = dayIso(sp.get("from")), to = dayIso(sp.get("to"));
  const range = (sp.get("range") ?? "").trim().slice(0, 12);
  const { startMs, endMs } = from && to ? rangeToWindow("custom", Date.now(), from, to) : rangeToWindow(range || "14d", Date.now());
  const empty = (scopeCampaigns: number) => (csv ? csvResponse([], []) : NextResponse.json({ rows: [], total: 0, page, pageSize: PAGE_SIZE, scopeCampaigns } satisfies AudiencePlayersResponse));

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
    const labelOf = new Map(live.map((c) => [c.id, c]));
    const campById = new Map(campaigns.map((c) => [c.id, c]));
    if (ids.length === 0) return empty(0);
    const laneWorkspaces = new Set(ids.map((id) => brandKey(labelOf.get(id)?.cio_workspace)));
    // A family filter arrives as a key and leaves as campaign ids, resolved with the tab's own rule.
    const familyIds = familyKey ? live.filter((c) => laneIds.has(c.id) && familyKeyOf(c) === familyKey).map((c) => c.id) : null;
    if (familyIds && familyIds.length === 0) return empty(ids.length);
    const label = campaignLabeller(live, brand);
    const familyOf = (campaignId: string): string => labelOf.get(campaignId)?.parent_campaign_id ?? campaignId;

    const callRpc = async (limit: number, offset: number): Promise<RpcRow[]> => {
      const { data, error } = await supabaseAdmin.rpc("audience_lane_players", {
        p_campaign_ids: ids,
        p_from: new Date(startMs).toISOString(),
        p_to: new Date(endMs).toISOString(),
        p_deposited: deposited,
        p_contact: contact,
        p_family_ids: familyIds,
        p_q: q || null,
        p_sort: sort,
        p_dir: dir,
        p_limit: limit,
        p_offset: offset,
        // Sent ONLY when asked for. PostgREST resolves an RPC by argument NAMES, so passing this
        // to the v3 function (which has no such parameter) fails to resolve and the whole tab
        // 404s. Omitting it at the default keeps the page working before the migration lands.
        ...(attribDays > 0 ? { p_attrib_days: attribDays } : {}),
      });
      if (error) throw new Error(error.message);
      const out = (data ?? []) as RpcRow[];
      // The strict filters are applied INSIDE the function. On v3 there is no 'spoke' branch, so
      // its CASE falls through to TRUE and every player comes back — a silent wrong answer rather
      // than an error. Refuse instead of lying about who was spoken to.
      if ((contact === "spoke" || contact === "never_spoke") && out.length > 0 && out[0].spoke_with === undefined) {
        throw new Error(
          "The \"Spoke with them\" filter needs 2026-09-10_audience_lane_players_v4_strict_reached.sql applied to the database.",
        );
      }
      return out;
    };

    if (csv) {
      const all: RpcRow[] = [];
      let total = 0;
      for (let offset = 0; offset < CSV_CAP; offset += RPC_PAGE) {
        const chunk = await callRpc(RPC_PAGE, offset);
        if (chunk.length) total = Number(chunk[0].total_count);
        all.push(...chunk);
        if (chunk.length < RPC_PAGE || all.length >= total) break;
      }
      const head = ["phone", "name", "brand", "market", "family", "first_contact", "last_contact", "calls", "reached", "spoke_with", "texted", "sms_delivered", "deposits_after_contact", "gross_eur_after_contact", "first_deposit_after_contact", "last_deposit", "crm_record"];
      const lines = all.map((r) => {
        const c = r.last_campaign_id ? labelOf.get(r.last_campaign_id) : undefined;
        return [
          r.phone_e164, r.display_name ?? "", brandLabel(c?.cio_workspace), parseCountryToken(c?.name ?? "") || "",
          r.last_campaign_id ? label(r.last_campaign_id) : "", r.first_at ?? "", r.last_at ?? "", r.calls,
          r.reached ? "yes" : "no", r.spoke_with === true ? "yes" : "no", r.texted ? "yes" : "no", r.delivered ? "yes" : "no",
          r.dep_after, Number(r.dep_after_eur).toFixed(2), r.first_dep_after_at ?? "", r.last_dep_at ?? "", r.cio_known ? "yes" : "no record",
        ];
      });
      return csvResponse(head, lines, total > all.length ? `first ${all.length} of ${total} players` : undefined);
    }

    const rpcRows = await callRpc(PAGE_SIZE, (page - 1) * PAGE_SIZE);
    const total = rpcRows.length ? Number(rpcRows[0].total_count) : 0;
    if (rpcRows.length === 0) return NextResponse.json({ rows: [], total, page, pageSize: PAGE_SIZE, scopeCampaigns: ids.length } satisfies AudiencePlayersResponse);

    // ── Enrich the page: every number those phones hold in the lane, their calls, texts, identities, deposits. ──
    const phoneOrder = rpcRows.map((r) => r.phone_e164);
    const inLane = new Set(ids);
    // The lane's campaign ids are filtered HERE, not in the query: an All-brands lane is 300+ uuids,
    // and beside a 200-key IN the request line passes what the server accepts (measured 2026-09-07).
    const nums = ((await fetchRowsIn(
      supabaseAdmin,
      "campaign_numbers_v2",
      "id, campaign_id, phone_e164, display_name, outcome, attempt_count, last_attempted_at, cio_id",
      "phone_e164",
      phoneOrder,
    )) as unknown as Num[]).filter((n) => inLane.has(n.campaign_id));
    const numIds = nums.map((n) => n.id);
    const [calls, sms, seen] = await Promise.all([
      fetchRowsIn(supabaseAdmin, "calls_v2", "id, campaign_id, campaign_number_id, status, goal_reached, created_at, voicemail, duration_seconds, ended_reason", "campaign_number_id", numIds) as unknown as Promise<DashCallRow[]>,
      fetchRowsIn(supabaseAdmin, "sms_messages_v2", "campaign_number_id, status, created_at", "campaign_number_id", numIds) as unknown as Promise<Sms[]>,
      fetchRowsIn(supabaseAdmin, "realtime_seen_members", "phone_e164, cio_id, parent_campaign_id", "phone_e164", phoneOrder) as unknown as Promise<Seen[]>,
    ]);
    const idsOfPhone = new Map<string, Map<string, { workspace: string; cioId: string }>>();
    const addId = (ph: string, ws: string, cio: string | null) => {
      if (!cio || !laneWorkspaces.has(ws)) return;
      const m = idsOfPhone.get(ph) ?? new Map();
      m.set(`${ws}|${cio}`, { workspace: ws, cioId: cio });
      idsOfPhone.set(ph, m);
    };
    for (const n of nums) addId(n.phone_e164, brandKey(labelOf.get(n.campaign_id)?.cio_workspace), n.cio_id);
    for (const s of seen) addId(s.phone_e164, brandKey(campById.get(s.parent_campaign_id)?.cio_workspace), s.cio_id);
    const allCio = [...new Set([...idsOfPhone.values()].flatMap((m) => [...m.values()].map((x) => x.cioId)))];
    const cioDeposits = allCio.length
      ? ((await fetchRowsIn(supabaseAdmin, "cio_events", "workspace, cio_id, occurred_at, currency, amount_local, amount_norm", "cio_id", allCio, (qq) => qq.eq("event_name", "deposit_made"))) as unknown as CioDeposit[])
      : [];
    const depositsOfKey = new Map<string, CioDeposit[]>();
    for (const d of cioDeposits) { const k = `${d.workspace}|${d.cio_id}`; const g = depositsOfKey.get(k); if (g) g.push(d); else depositsOfKey.set(k, [d]); }

    const declined = new Set(nums.filter((n) => (n.outcome ?? "") === "declined_offer").map((n) => n.id));
    const smsSentNumbers = new Set(sms.filter((m) => isSmsSent(m.status)).map((m) => m.campaign_number_id));
    const smsByNumber = new Map<string, Sms[]>();
    for (const m of sms) { const g = smsByNumber.get(m.campaign_number_id); if (g) g.push(m); else smsByNumber.set(m.campaign_number_id, [m]); }
    const numById = new Map(nums.map((n) => [n.id, n]));
    const byPhone = new Map<string, Num[]>();
    for (const n of nums) { const g = byPhone.get(n.phone_e164); if (g) g.push(n); else byPhone.set(n.phone_e164, [n]); }
    const callsByPhone = new Map<string, DashCallRow[]>();
    for (const c of calls) {
      const n = c.campaign_number_id ? numById.get(c.campaign_number_id) : undefined;
      if (!n) continue;
      const g = callsByPhone.get(n.phone_e164); if (g) g.push(c); else callsByPhone.set(n.phone_e164, [c]);
    }

    const rows: AudiencePlayerRow[] = [];
    for (const r of rpcRows) {
      const ph = r.phone_e164;
      const group = byPhone.get(ph) ?? [];
      const cs = (callsByPhone.get(ph) ?? []).sort((a, b) => ((a.created_at ?? "") < (b.created_at ?? "") ? 1 : -1));
      const latestCall = cs[0];
      const latestNum = latestCall?.campaign_number_id ? numById.get(latestCall.campaign_number_id) : undefined;
      const leadCampaign = r.last_campaign_id ?? latestNum?.campaign_id ?? group[0]?.campaign_id ?? "";
      const lead = group.find((n) => n.campaign_id === leadCampaign) ?? latestNum ?? group[0];
      const tagged = cs.map((c) => ({ c, tag: deriveAttemptTag(c, declined.has(c.campaign_number_id ?? ""), { useTranscript: false }) }));
      const phoneSms = group.flatMap((n) => smsByNumber.get(n.id) ?? []).sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
      const keys = idsOfPhone.get(ph);
      const firstAt = r.first_at;
      const deposits: PlayerDeposit[] = (keys ? [...keys.keys()].flatMap((k) => depositsOfKey.get(k) ?? []) : [])
        .map((d) => ({ at: d.occurred_at, currency: d.currency, amountLocal: d.amount_local == null ? null : Number(d.amount_local), amountEur: d.amount_norm == null ? null : Number(d.amount_norm), afterContact: !!firstAt && d.occurred_at >= firstAt }))
        .sort((a, b) => (a.at < b.at ? 1 : -1));
      const events: PlayerEvent[] = [
        ...tagged.slice(0, 6).map((x) => ({ at: x.c.created_at ?? "", kind: "call" as const, what: x.tag, durationSeconds: x.c.duration_seconds ?? null })),
        ...phoneSms.slice(0, 3).map((m) => ({ at: m.created_at, kind: "sms" as const, what: m.status })),
        ...deposits.slice(0, 4).map((d) => ({ at: d.at, kind: "dep" as const, what: `${d.currency ?? ""} ${d.amountLocal == null ? "" : d.amountLocal.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`.trim() })),
      ].filter((e) => e.at).sort((a, b) => (a.at < b.at ? 1 : -1));
      const families = [...new Set(group.map((n) => familyOf(n.campaign_id)))];
      rows.push({
        phone: ph,
        name: r.display_name ?? group.find((n) => n.display_name)?.display_name ?? null,
        market: parseCountryToken(labelOf.get(leadCampaign)?.name ?? "") || "",
        campaignId: leadCampaign,
        campaignLabel: leadCampaign ? label(leadCampaign) : "",
        alsoIn: families.filter((f) => f !== familyOf(leadCampaign)).map((f) => { const anyRun = group.find((n) => familyOf(n.campaign_id) === f); return anyRun ? label(anyRun.campaign_id) : f.slice(0, 8); }),
        numberId: lead?.id ?? "",
        dots: tagged.slice(0, DOTS).map((x) => DOT_OF[x.tag]),
        calls: r.calls,
        reached: r.reached,
        // Optional on the row so the page still renders against the v3 function, which has no
        // such column, until 2026-09-10_audience_lane_players_v4_strict_reached.sql is applied.
        spokeWith: r.spoke_with === true,
        smsSent: group.some((n) => smsSentNumbers.has(n.id)),
        smsDelivered: phoneSms.filter((m) => m.status === "delivered").length,
        firstAt: r.first_at,
        lastAt: r.last_at,
        events,
        runs: group
          .map((n) => ({ numberId: n.id, campaignId: n.campaign_id, campaignLabel: label(n.campaign_id), lastAt: n.last_attempted_at, outcome: n.outcome, attempts: n.attempt_count ?? 0 }))
          .sort((a, b) => ((a.lastAt ?? "") < (b.lastAt ?? "") ? 1 : -1)),
        cioKnown: r.cio_known,
        cio: keys ? [...keys.values()] : [],
        deposits,
      });
    }
    return NextResponse.json({ rows, total, page, pageSize: PAGE_SIZE, scopeCampaigns: ids.length } satisfies AudiencePlayersResponse);
  } catch (err) {
    console.error("[audience/players] failed:", err);
    return NextResponse.json({ error: "Failed to load players" }, { status: 500 });
  }
}

function csvResponse(head: string[], lines: (string | number | null)[][], note?: string): Response {
  const body = CSV_BOM + [head, ...lines].map((r) => r.map(csvCell).join(",")).join("\r\n") + (note ? `\r\n${csvCell(note)}` : "") + "\r\n";
  return new Response(body, { status: 200, headers: { "content-type": "text/csv; charset=utf-8", "cache-control": "no-store" } });
}
