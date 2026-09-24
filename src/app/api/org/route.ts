import { NextRequest, NextResponse } from "next/server";
import { getTenant, requireTenant } from "@/lib/tenant";
import { supabaseAdmin } from "@/lib/supabaseServer";

// GET  /api/org   → the caller's organization, role and brands (the OrgProvider's source)
// PATCH /api/org  → rename the organization (owners/admins)

export async function GET() {
  const tenant = await getTenant();
  if (!tenant) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  return NextResponse.json({
    provisioned: tenant.provisioned,
    email: tenant.user.email ?? null,
    platformAdmin: tenant.platformAdmin,
    org: tenant.org ? { id: tenant.org.id, name: tenant.org.name, slug: tenant.org.slug, plan: tenant.org.plan } : null,
    role: tenant.role,
    brands: tenant.brands,
  });
}

export async function PATCH(request: NextRequest) {
  const t = await requireTenant({ manage: true });
  if (!t.ok) return NextResponse.json({ error: t.error }, { status: t.status });
  let body: { name?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const name = (body.name ?? "").trim();
  if (name.length < 2 || name.length > 80) return NextResponse.json({ error: "Name must be 2–80 characters" }, { status: 400 });
  const { data, error } = await supabaseAdmin.from("organizations").update({ name }).eq("id", t.tenant.org.id).select("id, name, slug, plan").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ org: data });
}
