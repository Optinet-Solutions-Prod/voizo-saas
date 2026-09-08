import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseServer";
import { formatCampaign } from "@/lib/campaignDisplay";

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
export interface PlayerSmsResponse {
  phone: string;
  texts: PlayerSmsText[];
  pulledAt: string;
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
