import { NextRequest, NextResponse } from "next/server";
import { requireTenant } from "@/lib/tenant";
import { supabaseAdmin } from "@/lib/supabaseServer";
import { detectCountry } from "@/lib/audienceCountry";
import { NUMBER_PROVIDERS, isE164, normalizeE164 } from "@/lib/phoneNumbers";

// GET  /api/org/phone-numbers → the organization's caller IDs
// POST /api/org/phone-numbers { e164, label?, provider?, brandSlug? } → register one (owners/admins)

export async function GET() {
  const t = await requireTenant();
  if (!t.ok) return NextResponse.json({ error: t.error }, { status: t.status });
  const { data, error } = await supabaseAdmin
    .from("phone_numbers")
    .select("id, e164, label, provider, country, brand_slug, capabilities, status, last_tested_at, last_error, created_at")
    .eq("org_id", t.tenant.org.id)
    .order("created_at", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ numbers: data ?? [] });
}

export async function POST(request: NextRequest) {
  const t = await requireTenant({ manage: true });
  if (!t.ok) return NextResponse.json({ error: t.error }, { status: t.status });
  let body: { e164?: string; label?: string; provider?: string; brandSlug?: string | null };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const e164 = normalizeE164(body.e164 ?? "");
  if (!isE164(e164)) return NextResponse.json({ error: "Enter the number in international format, e.g. +442036953434" }, { status: 400 });
  const provider = NUMBER_PROVIDERS.some((p) => p.value === body.provider) ? body.provider : "other";
  const brandSlug = body.brandSlug && t.tenant.brands.some((b) => b.slug === body.brandSlug) ? body.brandSlug : null;
  const country = detectCountry(e164);

  const { data, error } = await supabaseAdmin
    .from("phone_numbers")
    .insert({ org_id: t.tenant.org.id, e164, label: (body.label ?? "").trim() || null, provider, brand_slug: brandSlug, country })
    .select("id, e164, label, provider, country, brand_slug, capabilities, status, last_tested_at, last_error, created_at")
    .single();
  if (error) {
    if (error.code === "23505") return NextResponse.json({ error: "That number is already registered" }, { status: 409 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ number: data }, { status: 201 });
}
