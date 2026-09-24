import { NextRequest, NextResponse } from "next/server";
import { requireTenant, slugify } from "@/lib/tenant";
import { supabaseAdmin, supabaseService } from "@/lib/supabaseServer";

// GET  /api/org/brands            → the organization's brands
// POST /api/org/brands { name, color? } → add one (owners/admins). Slug is derived from the
//      name and made globally unique, because campaigns_v2.cio_workspace is keyed by it.

export async function GET() {
  const t = await requireTenant();
  if (!t.ok) return NextResponse.json({ error: t.error }, { status: t.status });
  return NextResponse.json({ brands: t.tenant.brands });
}

export async function POST(request: NextRequest) {
  const t = await requireTenant({ manage: true });
  if (!t.ok) return NextResponse.json({ error: t.error }, { status: t.status });
  let body: { name?: string; color?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const name = (body.name ?? "").trim();
  if (name.length < 2 || name.length > 60) return NextResponse.json({ error: "Brand name must be 2–60 characters" }, { status: 400 });
  const color = body.color && /^#[0-9a-f]{6}$/i.test(body.color) ? body.color : null;

  // Unique slug across all organizations: base, base-2, base-3 …
  const base = slugify(name);
  const { data: taken } = await supabaseService.from("brands").select("slug").like("slug", `${base}%`);
  const used = new Set((taken ?? []).map((r) => r.slug as string));
  let slug = base;
  for (let n = 2; used.has(slug); n++) slug = `${base}-${n}`;

  const { data, error } = await supabaseAdmin
    .from("brands")
    .insert({ org_id: t.tenant.org.id, name, slug, color })
    .select("id, name, slug, color")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ brand: data }, { status: 201 });
}
