import { NextRequest, NextResponse } from "next/server";
import { getTenant } from "@/lib/tenant";
import { supabaseAdmin, supabaseService, tenancyProvisioned } from "@/lib/supabaseServer";

// Public (the middleware leaves /api/invites/* open; the token is the secret).
// GET  /api/invites/:token → { orgName, email, role, expired, accepted, signedInAs }
// POST /api/invites/:token → accept as the signed-in user (email must match)

export async function GET(_request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!(await tenancyProvisioned())) return NextResponse.json({ error: "Invites are not available yet" }, { status: 503 });
  const { data, error } = await supabaseService.rpc("invite_preview", { p_token: token });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return NextResponse.json({ error: "This invite link is not valid" }, { status: 404 });
  const tenant = await getTenant();
  return NextResponse.json({
    orgName: row.org_name,
    email: row.email,
    role: row.role,
    expired: !!row.expired,
    accepted: !!row.accepted,
    signedInAs: tenant?.user.email ?? null,
    alreadyInOrg: !!tenant?.org,
  });
}

export async function POST(_request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const tenant = await getTenant();
  if (!tenant) return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  if (!tenant.provisioned) return NextResponse.json({ error: "Invites are not available yet" }, { status: 503 });
  // Runs as the user: the function checks the email, expiry and existing membership.
  const { data, error } = await supabaseAdmin.rpc("accept_invite", { p_token: token });
  if (error) return NextResponse.json({ error: error.message.replace(/^.*?:\s*/, "") }, { status: 400 });
  return NextResponse.json({ org: data });
}
