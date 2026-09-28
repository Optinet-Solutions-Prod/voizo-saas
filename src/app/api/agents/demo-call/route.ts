import { NextRequest, NextResponse } from "next/server";
import { getTenant } from "@/lib/tenant";
import { AGENT_BY_KEY } from "@/lib/agents/catalog";
import { composeDemoAssistant } from "@/lib/agents/demo";
import { platformElevenLabsKey } from "@/lib/voices/orgVoices";

// POST /api/agents/demo-call { key, company, firstName, voiceId? }
// → { assistantId, overrides, publicKey }: the browser starts a web call on a persistent
// per-agent demo assistant with per-call overrides (first message, prompt, voice).
//
// Why a persistent assistant rather than a transient one: the ElevenLabs credential the voice
// may need must never reach the browser, and Vapi keeps credentials on the assistant record.
// One assistant per agent is created lazily (found again by metadata), so nothing piles up.

const VAPI = "https://api.vapi.ai";
const cache = new Map<string, string>(); // agentKey → assistantId (per server instance)

async function vapi(path: string, init: RequestInit = {}) {
  return fetch(`${VAPI}${path}`, { ...init, headers: { Authorization: `Bearer ${process.env.VAPI_PRIVATE_KEY}`, "Content-Type": "application/json", ...(init.headers ?? {}) }, cache: "no-store" });
}

async function demoAssistantId(agentKey: string, base: ReturnType<typeof composeDemoAssistant>): Promise<string> {
  const hit = cache.get(agentKey);
  if (hit) return hit;
  // Find an existing one (another instance may have created it).
  const list = await vapi(`/assistant?limit=100`).then((r) => (r.ok ? r.json() : [])).catch(() => []);
  const found = (Array.isArray(list) ? list : []).find((a: { metadata?: { voizoDemo?: boolean; agentKey?: string } }) => a.metadata?.voizoDemo && a.metadata?.agentKey === agentKey) as { id: string } | undefined;
  if (found) { cache.set(agentKey, found.id); return found.id; }
  const platformKey = platformElevenLabsKey();
  // The stored prompt is only a placeholder: every call overrides model / firstMessage / voice.
  // No webhook: demos never touch the database.
  const body = {
    ...base,
    name: `Demo · ${agentKey}`,
    ...(platformKey ? { credentials: [{ provider: "11labs", apiKey: platformKey }] } : {}),
  };
  const r = await vapi(`/assistant`, { method: "POST", body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`Vapi refused to create the demo assistant: ${(await r.text()).slice(0, 200)}`);
  const created = (await r.json()) as { id: string };
  cache.set(agentKey, created.id);
  return created.id;
}

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

  const assistant = composeDemoAssistant(agent, { company, firstName, voiceId });
  try {
    const assistantId = await demoAssistantId(agent.key, assistant);
    // Per-call overrides carry everything that varies; no secrets.
    const overrides = {
      firstMessage: assistant.firstMessage,
      firstMessageMode: assistant.firstMessageMode,
      model: assistant.model,
      voice: assistant.voice,
      endCallMessage: assistant.endCallMessage,
      metadata: { voizoDemo: true, agentKey: agent.key, company, firstName },
    };
    return NextResponse.json({ assistantId, overrides, publicKey, agent: { key: agent.key, name: agent.name, role: agent.role } });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Could not prepare the call" }, { status: 502 });
  }
}
