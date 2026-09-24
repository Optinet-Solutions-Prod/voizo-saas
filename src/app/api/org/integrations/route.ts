import { NextRequest, NextResponse } from "next/server";
import { requireTenant } from "@/lib/tenant";
import { supabaseAdmin } from "@/lib/supabaseServer";
import { decryptJson, encryptJson, maskSecret } from "@/lib/integrations/crypto";
import { PROVIDERS, PROVIDER_MAP, missingRequired, splitFields } from "@/lib/integrations/providers";

// GET /api/org/integrations → every provider with its stored state (secrets masked)
// PUT /api/org/integrations { provider, values } → save (owners/admins). Secret fields left
//     blank keep their stored value, so editing the region doesn't require re-entering keys.

export async function GET() {
  const t = await requireTenant();
  if (!t.ok) return NextResponse.json({ error: t.error }, { status: t.status });
  const { data, error } = await supabaseAdmin
    .from("org_integrations")
    .select("provider, credentials, config, status, last_tested_at, last_error, updated_at")
    .eq("org_id", t.tenant.org.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const stored = new Map((data ?? []).map((r) => [r.provider as string, r]));
  const items = await Promise.all(
    PROVIDERS.map(async (def) => {
      const row = stored.get(def.key);
      let masked: Record<string, string> = {};
      if (row && t.tenant.role !== "member") {
        try {
          const creds = await decryptJson<Record<string, string>>(row.credentials as string);
          masked = Object.fromEntries(Object.entries(creds).map(([k, v]) => [k, maskSecret(v)]));
        } catch {
          masked = {};
        }
      }
      return {
        provider: def.key,
        name: def.name,
        category: def.category,
        description: def.description,
        docsUrl: def.docsUrl,
        fields: def.fields,
        connected: !!row,
        config: (row?.config as Record<string, string>) ?? {},
        secrets: masked,
        status: (row?.status as string) ?? "untested",
        lastTestedAt: (row?.last_tested_at as string | null) ?? null,
        lastError: (row?.last_error as string | null) ?? null,
        updatedAt: (row?.updated_at as string | null) ?? null,
      };
    }),
  );
  return NextResponse.json({ integrations: items });
}

export async function PUT(request: NextRequest) {
  const t = await requireTenant({ manage: true });
  if (!t.ok) return NextResponse.json({ error: t.error }, { status: t.status });
  let body: { provider?: string; values?: Record<string, string> };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const def = body.provider ? PROVIDER_MAP[body.provider] : undefined;
  if (!def) return NextResponse.json({ error: "Unknown provider" }, { status: 400 });
  const { creds, config } = splitFields(def, body.values ?? {});

  // Merge with what's stored: blank secrets mean "keep".
  const { data: existing } = await supabaseAdmin
    .from("org_integrations")
    .select("credentials, config")
    .eq("org_id", t.tenant.org.id)
    .eq("provider", def.key)
    .maybeSingle();
  if (existing) {
    try {
      const prev = await decryptJson<Record<string, string>>(existing.credentials as string);
      for (const [k, v] of Object.entries(prev)) if (!creds[k]) creds[k] = v;
    } catch { /* unreadable old record: overwrite */ }
  }
  const missing = missingRequired(def, creds, config);
  if (missing.length) return NextResponse.json({ error: `Missing: ${missing.join(", ")}` }, { status: 400 });

  const row = {
    org_id: t.tenant.org.id,
    provider: def.key,
    credentials: await encryptJson(creds),
    config,
    status: "untested",
    last_error: null,
    created_by: t.tenant.user.id,
  };
  const { error } = await supabaseAdmin.from("org_integrations").upsert(row, { onConflict: "org_id,provider" });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
