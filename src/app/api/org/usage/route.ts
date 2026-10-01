import { NextRequest, NextResponse } from "next/server";
import { getTenant } from "@/lib/tenant";
import { supabaseService } from "@/lib/supabaseServer";

// GET /api/org/usage?days=30 → { days, row } — the signed-in organization's own spend.
export async function GET(request: NextRequest) {
  const tenant = await getTenant();
  if (!tenant?.org) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  const days = Math.min(365, Math.max(1, Number(request.nextUrl.searchParams.get("days") ?? 30) || 30));
  const { data, error } = await supabaseService.rpc("org_cost_summary", { p_days: days });
  if (error) return NextResponse.json({ error: /does not exist|schema cache/i.test(error.message) ? "Usage tracking isn't set up on this deployment yet." : error.message }, { status: 500 });
  const row = ((data ?? []) as { org_id: string | null }[]).find((r) => r.org_id === tenant.org!.id) ?? null;
  return NextResponse.json({ days, row });
}
