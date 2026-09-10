import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseServer";
import { formatCampaign } from "@/lib/campaignDisplay";
import { deriveAttemptTag, type AttemptTag } from "@/lib/dashboardAnalytics";

/**
 * GET /api/audience/player-calls?phone=+E164
 *
 * Every call Voizo placed to ONE player, for the drawer's "Calls" popup (Jasiel 2026-09-11: "make
 * the calls clickable too pls? so that we can track which campaign they're in and whatnot").
 *
 * WHY A ROUTE AND NOT THE ROW. The players row already carries a call COUNT and the last three
 * outcome dots, and its journey timeline carries the newest SIX calls. Measured 2026-09-11 across
 * the lane: median 3 calls per player, mean 3.9, p95 14, max 55, and **14.9% of players have more
 * than six**. Rendering that tail as "the calls" would repeat VOZ-482, where a truncated drawer
 * list was read as the whole list. So the popup reads every call, and it reads them only when it
 * is opened — the same lazy shape as player-sms and player-crm, so a page load pays nothing.
 *
 * The tag is deriveAttemptTag, the dashboard's own classifier, called with the SAME arguments the
 * players route uses (`useTranscript: false`), so a call cannot be labelled one thing in the table's
 * dots and another in this list.
 *
 * Read-only, our database only: two indexed reads plus a campaign-name lookup. Nothing here dials,
 * sends, or touches a provider. Same origin rule as its siblings; a cross-origin caller gets 403.
 */
export interface PlayerCall {
  id: string;
  at: string;
  /** The campaign's display label, e.g. "Australia · 20 NDFS + 300% DepMatch". */
  campaign: string;
  /** The dashboard's attempt vocabulary: positive, neutral, declined, voicemail, early_hangup, … */
  tag: AttemptTag;
  /** Provider status: completed, answered, no-answer, busy, failed, … */
  status: string;
  durationSeconds: number | null;
  endedReason: string | null;
  goalReached: boolean;
  voicemail: boolean;
}
export interface PlayerCallsResponse {
  phone: string;
  calls: PlayerCall[];
  pulledAt: string;
  /** True when the player has more calls than this route returns, so the popup can say so rather
   *  than presenting a truncated list as complete. Never expected below the 200 cap (max seen 55). */
  truncated: boolean;
}

const CAP = 200;

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
  const phone = (new URL(request.url).searchParams.get("phone") ?? "").trim();
  if (!/^\+\d{8,15}$/.test(phone)) return NextResponse.json({ error: "phone must be E.164" }, { status: 400 });

  // A phone sits in several campaigns, so the calls hang off its NUMBERS, not off the phone.
  const { data: nums, error: numErr } = await supabaseAdmin
    .from("campaign_numbers_v2")
    .select("id, campaign_id, outcome")
    .eq("phone_e164", phone);
  if (numErr) {
    console.error("[audience/player-calls] numbers read failed:", numErr.message);
    return NextResponse.json({ error: "Could not read the calls" }, { status: 500 });
  }
  if (!nums?.length) {
    return NextResponse.json({ phone, calls: [], pulledAt: new Date().toISOString(), truncated: false } satisfies PlayerCallsResponse);
  }
  const byNumber = new Map(nums.map((n) => [String(n.id), n]));

  const { data, error } = await supabaseAdmin
    .from("calls_v2")
    .select("id, campaign_id, campaign_number_id, status, goal_reached, voicemail, ended_reason, duration_seconds, transcript, created_at")
    .in("campaign_number_id", nums.map((n) => n.id))
    .order("created_at", { ascending: false })
    .limit(CAP + 1);
  if (error) {
    console.error("[audience/player-calls] read failed:", error.message);
    return NextResponse.json({ error: "Could not read the calls" }, { status: 500 });
  }
  const all = data ?? [];
  const rows = all.slice(0, CAP);

  // Campaign labels: one lookup for the few distinct ids, the dashboard's own labeller.
  const ids = [...new Set(rows.map((r) => r.campaign_id).filter((x): x is string => !!x))];
  const names = new Map<string, string>();
  if (ids.length) {
    const { data: camps } = await supabaseAdmin.from("campaigns_v2").select("id, name").in("id", ids);
    for (const c of camps ?? []) names.set(String(c.id), formatCampaign(c.name as string | null).display);
  }

  const out: PlayerCallsResponse = {
    phone,
    pulledAt: new Date().toISOString(),
    truncated: all.length > CAP,
    calls: rows.map((r) => {
      const num = byNumber.get(String(r.campaign_number_id));
      return {
        id: String(r.id),
        at: String(r.created_at ?? ""),
        campaign: (r.campaign_id && names.get(String(r.campaign_id))) || "",
        // Same call, same arguments, same answer as the table's dots.
        tag: deriveAttemptTag(
          {
            id: String(r.id), campaign_id: String(r.campaign_id ?? ""), campaign_number_id: String(r.campaign_number_id ?? ""),
            status: (r.status as string | null) ?? "completed",
            goal_reached: r.goal_reached as boolean | null,
            voicemail: r.voicemail as boolean | null,
            ended_reason: r.ended_reason as string | null,
            duration_seconds: r.duration_seconds as number | null,
            transcript: r.transcript as { text?: string | null } | string | null,
            created_at: r.created_at as string | null,
          },
          (num?.outcome ?? "") === "declined_offer",
        ),
        status: String(r.status ?? ""),
        durationSeconds: typeof r.duration_seconds === "number" ? r.duration_seconds : null,
        endedReason: r.ended_reason ? String(r.ended_reason) : null,
        goalReached: r.goal_reached === true,
        voicemail: r.voicemail === true,
      };
    }),
  };
  return NextResponse.json(out);
}
