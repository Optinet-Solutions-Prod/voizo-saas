import { NextRequest, NextResponse } from "next/server";
import { getTenant } from "@/lib/tenant";
import { supabaseService } from "@/lib/supabaseServer";
import { PLAN_BY_KEY } from "@/lib/pricing";

// PATCH /api/admin/org-plan { orgSlug, plan } → VOIZO platform staff set an organization's plan
// (no card checkout yet). Pro and Scale include every pre-built agent.
export async function PATCH(request: NextRequest) {
  const tenant = await getTenant();
  if (!tenant) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  if (!tenant.platformAdmin) return NextResponse.json({ error: "VOIZO platform admins only" }, { status: 403 });
  let body: { orgSlug?: string; plan?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body.orgSlug || !body.plan || !PLAN_BY_KEY[body.plan]) return NextResponse.json({ error: "orgSlug and a valid plan are required" }, { status: 400 });
  const { data, error } = await supabaseService.from("organizations").update({ plan: body.plan }).eq("slug", body.orgSlug).select("id, slug, plan").maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Organization not found" }, { status: 404 });
  return NextResponse.json({ org: data });
}
