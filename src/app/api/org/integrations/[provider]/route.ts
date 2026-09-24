import { NextRequest, NextResponse } from "next/server";
import { requireTenant } from "@/lib/tenant";
import { supabaseAdmin } from "@/lib/supabaseServer";
import { decryptJson } from "@/lib/integrations/crypto";
import { PROVIDER_MAP } from "@/lib/integrations/providers";

// POST   /api/org/integrations/:provider → test the stored connection, record the result
// DELETE /api/org/integrations/:provider → disconnect (owners/admins)

export async function POST(_request: NextRequest, { params }: { params: Promise<{ provider: string }> }) {
  const t = await requireTenant({ manage: true });
  if (!t.ok) return NextResponse.json({ error: t.error }, { status: t.status });
  const { provider } = await params;
  const def = PROVIDER_MAP[provider];
  if (!def) return NextResponse.json({ error: "Unknown provider" }, { status: 400 });

  const { data: row, error } = await supabaseAdmin
    .from("org_integrations")
    .select("credentials, config")
    .eq("org_id", t.tenant.org.id)
    .eq("provider", provider)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!row) return NextResponse.json({ error: "Save the credentials first" }, { status: 404 });

  let result;
  try {
    const creds = await decryptJson<Record<string, string>>(row.credentials as string);
    result = await def.test(creds, (row.config ?? {}) as Record<string, string>);
  } catch (e) {
    result = { ok: false, detail: e instanceof Error ? e.message : "Test failed" };
  }
  await supabaseAdmin
    .from("org_integrations")
    .update({ status: result.ok ? "ok" : "failed", last_tested_at: new Date().toISOString(), last_error: result.ok ? null : result.detail })
    .eq("org_id", t.tenant.org.id)
    .eq("provider", provider);
  return NextResponse.json({ result });
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ provider: string }> }) {
  const t = await requireTenant({ manage: true });
  if (!t.ok) return NextResponse.json({ error: t.error }, { status: t.status });
  const { provider } = await params;
  const { error, count } = await supabaseAdmin.from("org_integrations").delete({ count: "exact" }).eq("org_id", t.tenant.org.id).eq("provider", provider);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!count) return NextResponse.json({ error: "Not connected" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
