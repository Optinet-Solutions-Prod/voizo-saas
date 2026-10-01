import { NextRequest, NextResponse } from "next/server";
import { getTenant } from "@/lib/tenant";
import { supabaseService } from "@/lib/supabaseServer";

// GET /api/admin/org-costs?days=30 → { days, rows: org_cost_summary }   (VOIZO platform admins)
export async function GET(request: NextRequest) {
  const tenant = await getTenant();
  if (!tenant) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  if (!tenant.platformAdmin) return NextResponse.json({ error: "VOIZO platform admins only" }, { status: 403 });
  const days = Math.min(365, Math.max(1, Number(request.nextUrl.searchParams.get("days") ?? 30) || 30));
  const { data, error } = await supabaseService.rpc("org_cost_summary", { p_days: days });
  if (error) return NextResponse.json({ error: /does not exist|schema cache/i.test(error.message) ? "Run supabase-migration-usage-events.sql first." : error.message }, { status: 500 });
  return NextResponse.json({ days, rows: data ?? [] });
}
