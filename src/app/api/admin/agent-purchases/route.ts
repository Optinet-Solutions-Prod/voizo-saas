import { NextRequest, NextResponse } from "next/server";
import { getTenant } from "@/lib/tenant";
import { supabaseService } from "@/lib/supabaseServer";
import { AGENT_BY_KEY } from "@/lib/agents/catalog";

// VOIZO platform admins (auth app_metadata.role = "admin") unlock paid agents for an
// organization until card checkout exists.
//   GET    /api/admin/agent-purchases?org=<slug>          → unlocked keys for that org
//   POST   /api/admin/agent-purchases { orgSlug, agentKey, note? }
//   DELETE /api/admin/agent-purchases?org=<slug>&agent=<key>

async function requirePlatformAdmin() {
  const tenant = await getTenant();
  if (!tenant) return { error: NextResponse.json({ error: "Authentication required" }, { status: 401 }) };
  if (!tenant.platformAdmin) return { error: NextResponse.json({ error: "VOIZO platform admins only" }, { status: 403 }) };
  return { tenant };
}

async function orgBySlug(slug: string) {
  const { data } = await supabaseService.from("organizations").select("id, name, slug").eq("slug", slug).maybeSingle();
  return data;
}

export async function GET(request: NextRequest) {
  const g = await requirePlatformAdmin();
  if ("error" in g) return g.error;
  const slug = request.nextUrl.searchParams.get("org");
  if (!slug) {
    const { data } = await supabaseService.from("organizations").select("id, name, slug, plan, created_at").order("created_at", { ascending: false }).limit(200);
    return NextResponse.json({ organizations: data ?? [] });
  }
  const org = await orgBySlug(slug);
  if (!org) return NextResponse.json({ error: "Organization not found" }, { status: 404 });
  const { data } = await supabaseService.from("agent_purchases").select("agent_key, created_at, note").eq("org_id", org.id);
  return NextResponse.json({ org, purchases: data ?? [] });
}

export async function POST(request: NextRequest) {
  const g = await requirePlatformAdmin();
  if ("error" in g) return g.error;
  let body: { orgSlug?: string; agentKey?: string; note?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body.orgSlug || !body.agentKey || !AGENT_BY_KEY[body.agentKey]) return NextResponse.json({ error: "orgSlug and a valid agentKey are required" }, { status: 400 });
  const org = await orgBySlug(body.orgSlug);
  if (!org) return NextResponse.json({ error: "Organization not found" }, { status: 404 });
  const { error } = await supabaseService
    .from("agent_purchases")
    .upsert({ org_id: org.id, agent_key: body.agentKey, unlocked_by: g.tenant.user.id, note: body.note ?? null }, { onConflict: "org_id,agent_key" });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: NextRequest) {
  const g = await requirePlatformAdmin();
  if ("error" in g) return g.error;
  const slug = request.nextUrl.searchParams.get("org");
  const key = request.nextUrl.searchParams.get("agent");
  if (!slug || !key) return NextResponse.json({ error: "org and agent are required" }, { status: 400 });
  const org = await orgBySlug(slug);
  if (!org) return NextResponse.json({ error: "Organization not found" }, { status: 404 });
  const { error } = await supabaseService.from("agent_purchases").delete().eq("org_id", org.id).eq("agent_key", key);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
