import { NextRequest, NextResponse } from "next/server";
import { requireTenant } from "@/lib/tenant";
import { supabaseAdmin } from "@/lib/supabaseServer";
import { sendEmail } from "@/lib/email";

// GET  /api/org/invites                 → pending + accepted invites (owners/admins)
// POST /api/org/invites { email, role } → create one; emails the link when Resend is configured,
//      and always returns the link so the admin can share it by hand.

export async function GET() {
  const t = await requireTenant({ manage: true });
  if (!t.ok) return NextResponse.json({ error: t.error }, { status: t.status });
  const { data, error } = await supabaseAdmin
    .from("organization_invites")
    .select("id, email, role, token, created_at, expires_at, accepted_at")
    .eq("org_id", t.tenant.org.id)
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ invites: data ?? [] });
}

export async function POST(request: NextRequest) {
  const t = await requireTenant({ manage: true });
  if (!t.ok) return NextResponse.json({ error: t.error }, { status: t.status });
  let body: { email?: string; role?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const email = (body.email ?? "").trim().toLowerCase();
  const role = body.role === "admin" ? "admin" : "member";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return NextResponse.json({ error: "Enter a valid email address" }, { status: 400 });

  // One live invite per address per org: reuse it instead of minting a second link.
  const { data: existing } = await supabaseAdmin
    .from("organization_invites")
    .select("id, token, role")
    .eq("org_id", t.tenant.org.id)
    .ilike("email", email)
    .is("accepted_at", null)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();

  let invite = existing;
  if (!invite) {
    const { data, error } = await supabaseAdmin
      .from("organization_invites")
      .insert({ org_id: t.tenant.org.id, email, role, invited_by: t.tenant.user.id })
      .select("id, token, role")
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    invite = data;
  }

  const origin = request.headers.get("origin") ?? request.nextUrl.origin;
  const link = `${origin}/invite/${invite!.token}`;

  let emailed = false;
  if (process.env.RESEND_API_KEY && process.env.RESEND_FROM) {
    try {
      await sendEmail(
        [email],
        `You're invited to ${t.tenant.org.name} on VOIZO`,
        `<p>${t.tenant.user.email ?? "A colleague"} invited you to join <strong>${t.tenant.org.name}</strong> on VOIZO as ${invite!.role}.</p><p><a href="${link}">Accept the invitation</a></p><p>This link expires in 14 days.</p>`,
        `${t.tenant.user.email ?? "A colleague"} invited you to join ${t.tenant.org.name} on VOIZO as ${invite!.role}.\n\nAccept: ${link}\n\nThis link expires in 14 days.`,
      );
      emailed = true;
    } catch (e) {
      console.warn("[invites] email failed:", e instanceof Error ? e.message : e);
    }
  }
  return NextResponse.json({ invite: { id: invite!.id, email, role: invite!.role, link, emailed } }, { status: existing ? 200 : 201 });
}
