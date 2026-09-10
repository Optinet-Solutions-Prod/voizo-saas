import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseServer";
import { formatCampaign } from "@/lib/campaignDisplay";
import { deriveAttemptTag, type AttemptTag } from "@/lib/dashboardAnalytics";
import { decideSmsDispatch, resolveSmsConsentMode, type SmsConsentMode } from "@/lib/smsDispatchDecision";
import { agentMentionedSms, agentSpokeOffer, customerDeclinedSms, customerRiskDisclosure, hasGenuineCustomerConsent, hasRealConversation } from "@/lib/transcriptClassify";

/**
 * GET /api/audience/player-sms?phone=+E164
 *
 * Every text Voizo sent ONE player, from our own sms_messages_v2, for the drawer's "Texts we sent"
 * popup (Jasiel 2026-09-08: "how about the messages we sent? like in Mobivate? that's important
 * too"). The drawer's row already carries a per-text status word from the players function; this
 * adds what that cannot: the body we sent, the sender name, the receipt time, the failure reason,
 * and (once the nightly Mobivate reconcile has run) the price and part count.
 *
 * Read-only, our database only, one indexed read plus a campaign-name lookup. Nothing here touches
 * Mobivate, a dial, or a send. Same origin rule as player-crm: a cross-origin caller gets 403.
 */
export interface PlayerSmsText {
  id: string;
  /** When we created the row, which is when we sent it (state is written before the provider call). */
  at: string;
  /** Last change; for a delivered text this is when the receipt landed. */
  updatedAt: string | null;
  /** The campaign's display label, e.g. "Australia · 20 NDFS + 300% DepMatch". */
  campaign: string;
  sender: string | null;
  body: string;
  /** Our vocabulary: queued | sent | delivered | failed | undelivered. */
  status: string;
  /** The provider's word or our own reason, when the text did not deliver. */
  error: string | null;
  priceEur: number | null;
  parts: number | null;
}
/** Why no text went out, when none did (Jasiel 2026-09-08: "we spoke but why didn't we send SMS?").
 *  The dispatch decision is only logged at call time, never stored, so this REPLAYS it on the
 *  player's latest call with the same functions the webhook uses (deriveAttemptTag, decideSmsDispatch
 *  and the transcript classifiers) and the campaign's current SMS settings. Same inputs, same
 *  answer; replayed on +61474946524 it reproduced the live outcome (early_hangup). */
export interface SmsWhy {
  /** The campaign has SMS on and a template, so a text was possible at all. */
  configured: boolean;
  /** What the rule decided for the latest call: true means a text was expected and none exists. */
  attempt: boolean;
  /** decideSmsDispatch's own reason word, e.g. early_hangup, voicemail, silent_pickup, not_reached. */
  reason: string;
  mode: SmsConsentMode;
  tag: AttemptTag | null;
  lastCallAt: string | null;
}
export interface PlayerSmsResponse {
  phone: string;
  texts: PlayerSmsText[];
  pulledAt: string;
  /** Only when `texts` is empty and the player has at least one call; null otherwise. */
  why: SmsWhy | null;
}

/** The webhook's decision, re-run on the latest call. Read-only. */
async function whyNoText(phone: string): Promise<SmsWhy | null> {
  const { data: nums } = await supabaseAdmin.from("campaign_numbers_v2").select("id, campaign_id, outcome").eq("phone_e164", phone);
  if (!nums?.length) return null;
  const byNumber = new Map(nums.map((n) => [n.id as string, n]));
  const { data: calls } = await supabaseAdmin
    .from("calls_v2")
    .select("id, campaign_id, campaign_number_id, status, goal_reached, voicemail, ended_reason, duration_seconds, transcript, created_at")
    .in("campaign_number_id", nums.map((n) => n.id))
    .order("created_at", { ascending: false })
    .limit(1);
  const call = calls?.[0];
  if (!call) return null;
  const [{ data: camp }, { data: sup }] = await Promise.all([
    supabaseAdmin.from("campaigns_v2").select("sms_enabled, sms_template, sms_consent_mode, sms_on_goal_reached_only, sms_last_resort_template").eq("id", call.campaign_id).single(),
    supabaseAdmin.from("suppression_list").select("id").eq("phone_e164", phone).limit(1),
  ]);
  const mode = resolveSmsConsentMode(camp?.sms_consent_mode);
  const configured = camp?.sms_enabled === true && Boolean(camp?.sms_template) && (mode !== "verbal_yes" || camp?.sms_on_goal_reached_only === true);
  const text = call.transcript && typeof call.transcript === "object" && "text" in call.transcript ? String((call.transcript as { text?: unknown }).text ?? "") : typeof call.transcript === "string" ? call.transcript : "";
  const num = byNumber.get(call.campaign_number_id as string);
  const tag = deriveAttemptTag(
    {
      id: call.id as string, campaign_id: call.campaign_id as string, campaign_number_id: call.campaign_number_id as string,
      status: (call.status as string | null) ?? "completed", goal_reached: call.goal_reached as boolean | null, voicemail: call.voicemail as boolean | null,
      ended_reason: call.ended_reason as string | null, duration_seconds: call.duration_seconds as number | null, transcript: call.transcript as { text?: string | null } | string | null,
      created_at: call.created_at as string | null,
    },
    (num?.outcome ?? "") === "declined_offer",
  );
  const decision = decideSmsDispatch({
    mode,
    goalReached: call.goal_reached === true,
    nativeSuccess: false,
    voicemailDetected: call.voicemail === true,
    optedOut: Boolean(sup?.length) || (text ? customerRiskDisclosure(text) !== null : false),
    attemptTag: tag,
    hasVerbalConsent: text ? hasGenuineCustomerConsent(text) : false,
    agentAnnouncedSms: text ? agentMentionedSms(text) : false,
    customerDeclinedSms: text ? customerDeclinedSms(text) : false,
    humanConversation: text ? hasRealConversation(text) : false,
    // Same input the webhook passes, so the drawer's "why no text" can never disagree with dispatch.
    agentSpokeOffer: text ? agentSpokeOffer(text) : false,
    lastResortMode: typeof camp?.sms_last_resort_template === "string" && camp.sms_last_resort_template.trim().length > 0,
  });
  return { configured, attempt: decision.attempt, reason: decision.reason, mode, tag, lastCallAt: (call.created_at as string | null) ?? null };
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
  const phone = (new URL(request.url).searchParams.get("phone") ?? "").trim();
  if (!/^\+\d{8,15}$/.test(phone)) return NextResponse.json({ error: "phone must be E.164" }, { status: 400 });

  const { data, error } = await supabaseAdmin
    .from("sms_messages_v2")
    .select("id, campaign_id, sender_id, body, status, error_message, created_at, updated_at, price_eur, parts")
    .eq("to_phone_e164", phone)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) {
    console.error("[audience/player-sms] read failed:", error.message);
    return NextResponse.json({ error: "Could not read the texts" }, { status: 500 });
  }
  const rows = data ?? [];

  // Campaign labels: one lookup for the few distinct ids, the dashboard's own labeller.
  const ids = [...new Set(rows.map((r) => r.campaign_id).filter((x): x is string => !!x))];
  const names = new Map<string, string>();
  if (ids.length) {
    const { data: camps } = await supabaseAdmin.from("campaigns_v2").select("id, name").in("id", ids);
    for (const c of camps ?? []) names.set(c.id as string, formatCampaign(c.name as string | null).display);
  }

  const out: PlayerSmsResponse = {
    phone,
    pulledAt: new Date().toISOString(),
    why: rows.length ? null : await whyNoText(phone).catch((e: unknown) => { console.error("[audience/player-sms] why failed:", e instanceof Error ? e.message : e); return null; }),
    texts: rows.map((r) => ({
      id: String(r.id),
      at: String(r.created_at),
      updatedAt: r.updated_at ? String(r.updated_at) : null,
      campaign: (r.campaign_id && names.get(r.campaign_id)) || "",
      sender: r.sender_id ? String(r.sender_id) : null,
      body: String(r.body ?? ""),
      status: String(r.status ?? ""),
      error: r.error_message ? String(r.error_message) : null,
      priceEur: typeof r.price_eur === "number" ? r.price_eur : r.price_eur != null ? Number(r.price_eur) : null,
      parts: typeof r.parts === "number" ? r.parts : null,
    })),
  };
  return NextResponse.json(out);
}
