import { NextRequest, NextResponse } from "next/server";
import { getTenant, slugify } from "@/lib/tenant";
import { supabaseAdmin } from "@/lib/supabaseServer";

// POST /api/org/create { name } → creates the organization with the caller as owner.
// Refused when the caller already belongs to one (the database function checks too).
export async function POST(request: NextRequest) {
  const tenant = await getTenant();
  if (!tenant) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  if (!tenant.provisioned) return NextResponse.json({ error: "Organizations are not set up yet (tenancy migration not applied)" }, { status: 503 });
  if (tenant.org) return NextResponse.json({ error: "You already belong to an organization" }, { status: 409 });

  let body: { name?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const name = (body.name ?? "").trim();
  if (name.length < 2 || name.length > 80) return NextResponse.json({ error: "Name must be 2–80 characters" }, { status: 400 });

  // Runs as the signed-in user (auth.uid() inside the function is them).
  const { data, error } = await supabaseAdmin.rpc("create_organization", { p_name: name, p_slug: slugify(name) });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ org: data });
}
