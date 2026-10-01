import { NextRequest, NextResponse } from "next/server";
import { getTenant } from "@/lib/tenant";
import { AGENT_BY_KEY } from "@/lib/agents/catalog";
import { demoAssistantId, demoOverrides } from "@/lib/agents/demoAssistant";

// POST /api/agents/demo-call { key, company, firstName, voiceId? }
// → { assistantId, overrides, publicKey }: the browser starts a web call on the persistent
// per-agent demo assistant with per-call overrides (first message, prompt, voice). Signed-in
// users may try any agent, paid or free — trying is the point; installing stays gated.
export async function POST(request: NextRequest) {
  const tenant = await getTenant();
  if (!tenant) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  const publicKey = process.env.NEXT_PUBLIC_VAPI_PUBLIC_KEY;
  if (!publicKey || !process.env.VAPI_PRIVATE_KEY) return NextResponse.json({ error: "Voice calling isn't configured on this deployment (Vapi keys)." }, { status: 503 });

  let body: { key?: string; company?: string; firstName?: string; voiceId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const agent = body.key ? AGENT_BY_KEY[body.key] : undefined;
  if (!agent) return NextResponse.json({ error: "Unknown agent" }, { status: 400 });
  const company = (body.company ?? "").trim().slice(0, 80);
  const firstName = (body.firstName ?? "").trim().slice(0, 40);
  const voiceId = body.voiceId && /^[A-Za-z0-9]{10,40}$/.test(body.voiceId) ? body.voiceId : undefined;

  try {
    const assistantId = await demoAssistantId(agent);
    const overrides = demoOverrides(agent, { company, firstName, voiceId }, { orgId: tenant.org?.id });
    return NextResponse.json({ assistantId, overrides, publicKey, agent: { key: agent.key, name: agent.name, role: agent.role } });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Could not prepare the call" }, { status: 502 });
  }
}
