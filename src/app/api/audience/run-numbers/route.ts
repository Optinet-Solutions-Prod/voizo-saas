import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseServer";
import { fetchRowsIn } from "@/lib/supabaseFetchAll";
import { deriveAttemptTag, type DashCallRow } from "@/lib/dashboardAnalytics";
import { DOT_OF, type Dot } from "@/lib/audienceLane";
import { CSV_BOM, csvCell } from "@/lib/download";

/**
 * GET /api/audience/run-numbers?campaign=&page=&q=&deposited=&contact=&sort=&dir=
 *
 * "Numbers on this run": the players of ONE campaign run for the Audience tab's family expand
 * (mockup 2026-08-25, `numbers()`), ten to a page (Jasiel: 10 per page, not 50), newest contact
 * first, filtered by name or number and, since 2026-09-07 (Jasiel: "players who deposited during
 * that child-spawned campaign"), by Deposited and Contact. The rows come from audience_lane_players()
 * with the lane set to this one campaign, so the counts, the filters and the money follow the
 * same rules as the lane-wide list; the window is the run's own life (its start to now), which is
 * what "deposited during this run" means: at or after this run contacted them.
 *
 * Outcome is the Audience tab's four-word vocabulary (spoke / silent / voicemail / never) from the
 * LAST call's lean attempt tag, the same rule the Player activity dots use; "not dialled" when the
 * number has no call yet.
 *
 * Read-only, lenient origin (GET), Basic Auth via middleware. Phone and name are shown: this is
 * the same PII the campaign detail page already lists behind the same gate.
 */
const PAGE_SIZE = 10;
// `?format=csv` exports the WHOLE filtered set, not the page (Jasiel 2026-09-10: every table
// exports, for reporting). PostgREST clamps any response at 1,000 rows, an RPC's included, so the
// export pages the function in that step; CSV_CAP bounds a runaway loop if total_count ever
// disagreed with the rows returned. Same numbers as the players export.
const RPC_PAGE = 1_000;
const CSV_CAP = 20_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DEPOSITED = new Set(["any", "after", "before", "none", "unknown"]);
const CONTACT = new Set(["any", "reached", "texted", "delivered", "never"]);
const SORT = new Set(["last_contact", "first_contact", "amount", "calls", "phone"]);

export interface RunNumberRow {
  phone: string;
  name: string | null;
  calls: number;
  lastAt: string | null;
  /** null = never dialled. */
  outcome: Dot | null;
  /** Deposits at or after this run's first contact with the player, and their EUR-normalised gross. */
  depositsAfter: number;
  depositsAfterEur: number;
  firstDepositAfterAt: string | null;
  cioKnown: boolean;
}
export interface RunNumbersResponse {
  rows: RunNumberRow[];
  total: number;
  page: number;
  pageSize: number;
  /** The run's window as the query used it. */
  from: string;
}

type RpcRow = {
  phone_e164: string; display_name: string | null; first_at: string | null; last_at: string | null; calls: number;
  cio_known: boolean; dep_after: number; dep_after_eur: number | string; first_dep_after_at: string | null; total_count: number | string;
};

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
  const campaign = (sp.get("campaign") ?? "").trim();
  if (!UUID.test(campaign)) return NextResponse.json({ error: "campaign must be a uuid" }, { status: 400 });
  const page = Math.max(1, Math.trunc(Number(sp.get("page")) || 1));
  const q = (sp.get("q") ?? "").trim().slice(0, 60).replace(/[%_\\]/g, "");
  const deposited = DEPOSITED.has(sp.get("deposited") ?? "") ? (sp.get("deposited") as string) : "any";
  const contact = CONTACT.has(sp.get("contact") ?? "") ? (sp.get("contact") as string) : "any";
  const sort = SORT.has(sp.get("sort") ?? "") ? (sp.get("sort") as string) : "last_contact";
  const dir = sp.get("dir") === "asc" ? "asc" : "desc";
  const csv = sp.get("format") === "csv";

  try {
    const { data: camp, error: campErr } = await supabaseAdmin
      .from("campaigns_v2")
      .select("id, source, is_test, start_at, created_at")
      .eq("id", campaign)
      .maybeSingle();
    if (campErr) throw new Error(campErr.message);
    if (!camp || camp.source === "ghost_portal" || camp.is_test === true) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const from = new Date(camp.start_at ?? camp.created_at ?? 0).toISOString();
    const to = new Date().toISOString();

    const callRpc = async (limit: number, offset: number): Promise<RpcRow[]> => {
      const { data, error } = await supabaseAdmin.rpc("audience_lane_players", {
        p_campaign_ids: [campaign],
        p_from: from,
        p_to: to,
        p_deposited: deposited,
        p_contact: contact,
        p_family_ids: null,
        p_q: q || null,
        p_sort: sort,
        p_dir: dir,
        p_limit: limit,
        p_offset: offset,
      });
      if (error) throw new Error(error.message);
      return (data ?? []) as RpcRow[];
    };

    let rpcRows: RpcRow[];
    if (csv) {
      rpcRows = [];
      let expected = 0;
      for (let offset = 0; offset < CSV_CAP; offset += RPC_PAGE) {
        const chunk = await callRpc(RPC_PAGE, offset);
        if (chunk.length) expected = Number(chunk[0].total_count);
        rpcRows.push(...chunk);
        if (chunk.length < RPC_PAGE || rpcRows.length >= expected) break;
      }
    } else {
      rpcRows = await callRpc(PAGE_SIZE, (page - 1) * PAGE_SIZE);
    }
    const total = rpcRows.length ? Number(rpcRows[0].total_count) : 0;
    if (rpcRows.length === 0 && !csv) return NextResponse.json({ rows: [], total, page, pageSize: PAGE_SIZE, from } satisfies RunNumbersResponse);

    // The last call per player IN THIS RUN, for the outcome chip.
    const phones = rpcRows.map((r) => r.phone_e164);
    const nums = (await fetchRowsIn(supabaseAdmin, "campaign_numbers_v2", "id, phone_e164, outcome", "phone_e164", phones, (qq) => qq.eq("campaign_id", campaign))) as unknown as { id: string; phone_e164: string; outcome: string | null }[];
    const calls = nums.length
      ? ((await fetchRowsIn(
          supabaseAdmin,
          "calls_v2",
          "id, campaign_id, campaign_number_id, status, goal_reached, created_at, voicemail, duration_seconds, ended_reason",
          "campaign_number_id",
          nums.map((n) => n.id),
        )) as unknown as DashCallRow[])
      : [];
    const numById = new Map(nums.map((n) => [n.id, n]));
    const lastCall = new Map<string, DashCallRow>();
    for (const c of calls) {
      const n = c.campaign_number_id ? numById.get(c.campaign_number_id) : undefined;
      if (!n) continue;
      const cur = lastCall.get(n.phone_e164);
      if (!cur || (cur.created_at ?? "") < (c.created_at ?? "")) lastCall.set(n.phone_e164, c);
    }
    const declined = new Set(nums.filter((n) => (n.outcome ?? "") === "declined_offer").map((n) => n.id));
    const rows: RunNumberRow[] = rpcRows.map((r) => {
      const c = lastCall.get(r.phone_e164);
      return {
        phone: r.phone_e164,
        name: r.display_name,
        calls: r.calls,
        lastAt: r.last_at,
        outcome: c ? DOT_OF[deriveAttemptTag(c, declined.has(c.campaign_number_id ?? ""), { useTranscript: false })] : null,
        depositsAfter: r.dep_after,
        depositsAfterEur: Number(r.dep_after_eur) || 0,
        firstDepositAfterAt: r.first_dep_after_at,
        cioKnown: r.cio_known,
      };
    });
    if (csv) {
      // Same rows and the same filters as the table, every one of them. `outcome` is the table's
      // four-word vocabulary from the last call in this run; empty = never dialled.
      const head = ["phone", "name", "calls", "last_contact", "outcome", "deposits_after_this_run", "gross_eur_after_this_run", "first_deposit_after_this_run", "crm_record"];
      const lines = rows.map((r) => [
        r.phone, r.name ?? "", r.calls, r.lastAt ?? "", r.outcome ?? "",
        r.depositsAfter, r.depositsAfterEur.toFixed(2), r.firstDepositAfterAt ?? "", r.cioKnown ? "yes" : "no",
      ]);
      const body = CSV_BOM + [head, ...lines].map((l) => l.map(csvCell).join(",")).join("\r\n");
      return new NextResponse(body, {
        status: 200,
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="audience-run-numbers_${campaign}.csv"`,
          "Cache-Control": "no-store",
        },
      });
    }
    return NextResponse.json({ rows, total, page, pageSize: PAGE_SIZE, from } satisfies RunNumbersResponse);
  } catch (err) {
    console.error("[audience/run-numbers] failed:", err);
    return NextResponse.json({ error: "Failed to load the run's numbers" }, { status: 500 });
  }
}
