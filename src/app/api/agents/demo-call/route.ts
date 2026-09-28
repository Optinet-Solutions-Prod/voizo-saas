import { NextRequest, NextResponse } from "next/server";
import { getTenant } from "@/lib/tenant";
import { AGENT_BY_KEY } from "@/lib/agents/catalog";
import { composeDemoAssistant } from "@/lib/agents/demo";

// POST /api/agents/demo-call { key, company, firstName, voiceId? }
// → { assistant, publicKey }: a transient Vapi assistant for a browser demo call. Any signed-in
// user may try any agent (paid or free) — trying is the point; installing stays gated.
export async function POST(request: NextRequest) {
  const tenant = await getTenant();
  if (!tenant) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  const publicKey = process.env.NEXT_PUBLIC_VAPI_PUBLIC_KEY;
  if (!publicKey) return NextResponse.json({ error: "Voice calling isn't configured on this deployment (NEXT_PUBLIC_VAPI_PUBLIC_KEY)." }, { status: 503 });

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

  const assistant = composeDemoAssistant(agent, { company, firstName, voiceId });
  return NextResponse.json({ assistant, publicKey, agent: { key: agent.key, name: agent.name, role: agent.role } });
}
