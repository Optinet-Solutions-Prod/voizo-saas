import { NextRequest, NextResponse } from "next/server";
import { requireTenant } from "@/lib/tenant";
import { supabaseAdmin } from "@/lib/supabaseServer";
import { getOrgIntegration } from "@/lib/integrations/store";
import { PROVIDER_MAP } from "@/lib/integrations/providers";

// POST   /api/org/phone-numbers/:id → test the number: format, then the provider's own check
//        (Twilio: the number must be on the connected account; FreeSWITCH: the shim answers;
//        others: format only). Records the result on the row.
// DELETE /api/org/phone-numbers/:id

interface NumberRow { id: string; e164: string; provider: string }

async function testNumber(orgId: string, n: NumberRow): Promise<{ ok: boolean; detail: string }> {
  if (n.provider === "twilio") {
    const tw = await getOrgIntegration<{ authToken: string }>(orgId, "twilio");
    if (!tw) return { ok: false, detail: "Connect Twilio under Integrations first, then test again." };
    const sid = tw.config.accountSid ?? "";
    const auth = "Basic " + Buffer.from(`${sid}:${tw.credentials.authToken}`).toString("base64");
    try {
      const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/IncomingPhoneNumbers.json?PhoneNumber=${encodeURIComponent(n.e164)}`, { headers: { Authorization: auth }, cache: "no-store" });
      if (r.status === 401) return { ok: false, detail: "Twilio rejected the connected credentials." };
      if (!r.ok) return { ok: false, detail: `Twilio answered ${r.status}.` };
      const j = (await r.json().catch(() => ({}))) as { incoming_phone_numbers?: { friendly_name: string; capabilities?: { voice?: boolean; sms?: boolean } }[] };
      const hit = j.incoming_phone_numbers?.[0];
      if (!hit) return { ok: false, detail: `${n.e164} is not a number on the connected Twilio account.` };
      const caps = hit.capabilities ? Object.entries(hit.capabilities).filter(([, v]) => v).map(([k]) => k).join(", ") : "";
      return { ok: true, detail: `Verified on Twilio (${hit.friendly_name}${caps ? `; ${caps}` : ""}).` };
    } catch (e) {
      return { ok: false, detail: `Couldn't reach Twilio: ${e instanceof Error ? e.message : e}` };
    }
  }
  if (n.provider === "freeswitch") {
    const fs = await getOrgIntegration(orgId, "freeswitch");
    if (!fs) return { ok: false, detail: "Connect FreeSWITCH under Integrations first, then test again." };
    const res = await PROVIDER_MAP.freeswitch.test(fs.credentials, fs.config);
    return res.ok ? { ok: true, detail: "Number format is valid and the FreeSWITCH shim is reachable. A live test call comes with the dialing phase." } : res;
  }
  if (n.provider === "squaretalk") {
    const sq = await getOrgIntegration(orgId, "squaretalk");
    if (!sq) return { ok: false, detail: "Connect Squaretalk under Integrations first, then test again." };
    const res = await PROVIDER_MAP.squaretalk.test(sq.credentials, sq.config);
    return res.ok ? { ok: true, detail: "Number format is valid and Squaretalk is reachable." } : res;
  }
  return { ok: true, detail: "Number format is valid. No automatic ownership check is available for this carrier." };
}

export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const t = await requireTenant({ manage: true });
  if (!t.ok) return NextResponse.json({ error: t.error }, { status: t.status });
  const { id } = await params;
  const { data: n, error } = await supabaseAdmin.from("phone_numbers").select("id, e164, provider").eq("id", id).eq("org_id", t.tenant.org.id).maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!n) return NextResponse.json({ error: "Number not found" }, { status: 404 });
  const result = await testNumber(t.tenant.org.id, n as NumberRow);
  await supabaseAdmin
    .from("phone_numbers")
    .update({ status: result.ok ? "ok" : "failed", last_tested_at: new Date().toISOString(), last_error: result.ok ? null : result.detail })
    .eq("id", id)
    .eq("org_id", t.tenant.org.id);
  return NextResponse.json({ result });
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const t = await requireTenant({ manage: true });
  if (!t.ok) return NextResponse.json({ error: t.error }, { status: t.status });
  const { id } = await params;
  const { error, count } = await supabaseAdmin.from("phone_numbers").delete({ count: "exact" }).eq("id", id).eq("org_id", t.tenant.org.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!count) return NextResponse.json({ error: "Number not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
