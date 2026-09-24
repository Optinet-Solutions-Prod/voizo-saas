import { NextResponse } from "next/server";
import { AGENT_CATALOG, publicAgent } from "@/lib/agents/catalog";
import { sampleUrl } from "@/lib/agents/entitlements";

// Public (middleware leaves /api/public/* open): the agent gallery for the landing page.
export const revalidate = 3600;

export async function GET() {
  return NextResponse.json({
    agents: AGENT_CATALOG.map((a) => ({ ...publicAgent(a), sampleUrl: sampleUrl(a.key) })),
  });
}
