import { NextRequest, NextResponse } from "next/server";
import { getTenant } from "@/lib/tenant";
import { AGENT_BY_KEY } from "@/lib/agents/catalog";
import { canInstallAgent } from "@/lib/agents/entitlements";
import { installAgentTemplate } from "@/lib/agents/install";

// POST /api/agents/install { key, company? } → creates the script (+ Playbook scenarios) in the
// caller's organization. Paid agents need an unlock (agent_purchases) first.
export async function POST(request: NextRequest) {
  const tenant = await getTenant();
  if (!tenant) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  if (tenant.provisioned && !tenant.org) return NextResponse.json({ error: "Join or create an organization first" }, { status: 409 });
  let body: { key?: string; company?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const agent = body.key ? AGENT_BY_KEY[body.key] : undefined;
  if (!agent) return NextResponse.json({ error: "Unknown agent" }, { status: 400 });
  if (!(await canInstallAgent(tenant.org?.id ?? null, agent.key))) {
    return NextResponse.json({ error: `${agent.name} is a paid agent. Ask VOIZO to unlock it for your organization, or pick a free one.` }, { status: 402 });
  }
  try {
    const result = await installAgentTemplate(agent, { company: body.company });
    return NextResponse.json(result, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Install failed" }, { status: 500 });
  }
}
