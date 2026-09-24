import { NextRequest, NextResponse } from "next/server";
import { requireTenant } from "@/lib/tenant";
import { supabaseAdmin } from "@/lib/supabaseServer";

// PATCH  /api/org/brands/:id { name?, color? } → rename / recolor (slug never changes: campaigns key on it)
// DELETE /api/org/brands/:id                   → remove (campaigns keep their cio_workspace label)

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const t = await requireTenant({ manage: true });
  if (!t.ok) return NextResponse.json({ error: t.error }, { status: t.status });
  const { id } = await params;
  let body: { name?: string; color?: string | null };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const patch: Record<string, unknown> = {};
  if (body.name !== undefined) {
    const name = body.name.trim();
    if (name.length < 2 || name.length > 60) return NextResponse.json({ error: "Brand name must be 2–60 characters" }, { status: 400 });
    patch.name = name;
  }
  if (body.color !== undefined) {
    if (body.color !== null && !/^#[0-9a-f]{6}$/i.test(body.color)) return NextResponse.json({ error: "Color must be #rrggbb" }, { status: 400 });
    patch.color = body.color;
  }
  if (!Object.keys(patch).length) return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  const { data, error } = await supabaseAdmin.from("brands").update(patch).eq("id", id).eq("org_id", t.tenant.org.id).select("id, name, slug, color").maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Brand not found" }, { status: 404 });
  return NextResponse.json({ brand: data });
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const t = await requireTenant({ manage: true });
  if (!t.ok) return NextResponse.json({ error: t.error }, { status: t.status });
  const { id } = await params;
  const { error, count } = await supabaseAdmin.from("brands").delete({ count: "exact" }).eq("id", id).eq("org_id", t.tenant.org.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!count) return NextResponse.json({ error: "Brand not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
