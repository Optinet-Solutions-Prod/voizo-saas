import { NextResponse } from "next/server";
import { getTenant } from "@/lib/tenant";
import { supabaseAdmin } from "@/lib/supabaseServer";
import { AGENT_CATALOG, publicAgent } from "@/lib/agents/catalog";
import { sampleUrl, unlockedAgentKeys } from "@/lib/agents/entitlements";

// GET /api/agents → the catalog with this organization's unlocked + installed state.
export async function GET() {
  const tenant = await getTenant();
  if (!tenant) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  const unlocked = tenant.org ? await unlockedAgentKeys(tenant.org.id) : new Set(AGENT_CATALOG.filter((a) => a.tier === "free").map((a) => a.key));

  // Installed = a script in this org carrying the agent's tag on its handlers is heavy to join;
  // the script name pattern "<Name> — <Role>" is what installAgentTemplate writes.
  const { data: scripts } = await supabaseAdmin.from("listener_scripts").select("id, name").order("created_at", { ascending: false });
  const byName = new Map<string, string>();
  for (const s of scripts ?? []) if (!byName.has(s.name as string)) byName.set(s.name as string, s.id as string);

  return NextResponse.json({
    agents: AGENT_CATALOG.map((a) => ({
      ...publicAgent(a),
      sampleUrl: sampleUrl(a.key),
      unlocked: unlocked.has(a.key),
      installedScriptId: byName.get(`${a.name} — ${a.role}`) ?? null,
    })),
    canInstall: !!tenant.org || !tenant.provisioned,
  });
}
