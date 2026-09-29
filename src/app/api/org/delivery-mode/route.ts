import { NextRequest, NextResponse } from "next/server";
import { getTenant, requireTenant } from "@/lib/tenant";
import { supabaseAdmin } from "@/lib/supabaseServer";
import { deliveryModeOf, type DeliveryMode } from "@/lib/deliveryMode";

// GET   /api/org/delivery-mode → { mode }
// PATCH /api/org/delivery-mode { mode: "on_the_go" | "own" } → { mode }   (owners/admins)
export async function GET() {
  const t = await getTenant();
  if (!t?.org) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  return NextResponse.json({ mode: deliveryModeOf(t.org.settings) });
}

export async function PATCH(request: NextRequest) {
  const t = await requireTenant({ manage: true });
  if (!t.ok) return NextResponse.json({ error: t.error }, { status: t.status });
  let body: { mode?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const mode: DeliveryMode | null = body.mode === "own" || body.mode === "on_the_go" ? body.mode : null;
  if (!mode) return NextResponse.json({ error: "mode must be on_the_go or own" }, { status: 400 });
  const settings = { ...(t.tenant.org.settings ?? {}), delivery_mode: mode };
  const { error } = await supabaseAdmin.from("organizations").update({ settings }).eq("id", t.tenant.org.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ mode });
}
