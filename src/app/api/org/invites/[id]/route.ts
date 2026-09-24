import { NextRequest, NextResponse } from "next/server";
import { requireTenant } from "@/lib/tenant";
import { supabaseAdmin } from "@/lib/supabaseServer";

// DELETE /api/org/invites/:id → revoke a pending invite (owners/admins)
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const t = await requireTenant({ manage: true });
  if (!t.ok) return NextResponse.json({ error: t.error }, { status: t.status });
  const { id } = await params;
  const { error, count } = await supabaseAdmin.from("organization_invites").delete({ count: "exact" }).eq("id", id).eq("org_id", t.tenant.org.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!count) return NextResponse.json({ error: "Invite not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
