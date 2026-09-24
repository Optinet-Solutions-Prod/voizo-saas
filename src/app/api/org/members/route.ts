import { NextRequest, NextResponse } from "next/server";
import { requireTenant, type OrgRole } from "@/lib/tenant";
import { supabaseAdmin, supabaseService } from "@/lib/supabaseServer";

// GET   /api/org/members                      → members with email + role
// PATCH /api/org/members { userId, role }      → change a role (owners/admins; owners can't be changed)
// DELETE /api/org/members?userId=…             → remove a member (owners/admins; never the owner)

export async function GET() {
  const t = await requireTenant();
  if (!t.ok) return NextResponse.json({ error: t.error }, { status: t.status });
  const { data, error } = await supabaseAdmin
    .from("organization_members")
    .select("user_id, role, created_at")
    .eq("org_id", t.tenant.org.id)
    .order("created_at", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Emails live in auth.users: look each one up with the service role.
  const members = await Promise.all(
    (data ?? []).map(async (m) => {
      const { data: u } = await supabaseService.auth.admin.getUserById(m.user_id as string);
      return {
        userId: m.user_id as string,
        role: m.role as OrgRole,
        email: u?.user?.email ?? null,
        joinedAt: m.created_at as string,
        lastSignInAt: u?.user?.last_sign_in_at ?? null,
        isYou: m.user_id === t.tenant.user.id,
      };
    }),
  );
  return NextResponse.json({ members });
}

export async function PATCH(request: NextRequest) {
  const t = await requireTenant({ manage: true });
  if (!t.ok) return NextResponse.json({ error: t.error }, { status: t.status });
  let body: { userId?: string; role?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body.userId || (body.role !== "admin" && body.role !== "member")) {
    return NextResponse.json({ error: "userId and role (admin|member) required" }, { status: 400 });
  }
  if (body.userId === t.tenant.user.id) return NextResponse.json({ error: "You can't change your own role" }, { status: 400 });
  const { data, error } = await supabaseAdmin
    .from("organization_members")
    .update({ role: body.role })
    .eq("org_id", t.tenant.org.id)
    .eq("user_id", body.userId)
    .neq("role", "owner")
    .select("user_id, role")
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Member not found, or is the owner" }, { status: 404 });
  return NextResponse.json({ member: data });
}

export async function DELETE(request: NextRequest) {
  const t = await requireTenant({ manage: true });
  if (!t.ok) return NextResponse.json({ error: t.error }, { status: t.status });
  const userId = request.nextUrl.searchParams.get("userId");
  if (!userId) return NextResponse.json({ error: "userId required" }, { status: 400 });
  if (userId === t.tenant.user.id) return NextResponse.json({ error: "You can't remove yourself" }, { status: 400 });
  const { error, count } = await supabaseAdmin
    .from("organization_members")
    .delete({ count: "exact" })
    .eq("org_id", t.tenant.org.id)
    .eq("user_id", userId)
    .neq("role", "owner");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!count) return NextResponse.json({ error: "Member not found, or is the owner" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
