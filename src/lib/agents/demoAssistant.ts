import type { AgentTemplate } from "./catalog";
import { composeDemoAssistant, type DemoInput } from "./demo";
import { platformElevenLabsKey } from "../voices/orgVoices";

// One persistent Vapi assistant per agent for browser demo calls (in-app and public). It carries
// the platform ElevenLabs credential, which must never reach the browser; each call sends only
// per-call overrides (first message, prompt, voice, limits). Created lazily and found again by
// metadata, so nothing piles up across server instances.

const VAPI = "https://api.vapi.ai";
// Bump when composeDemoAssistant changes; assistants created with an older version are patched.
export const DEMO_VERSION = 4;
const cache = new Map<string, string>();

async function vapi(path: string, init: RequestInit = {}) {
  return fetch(`${VAPI}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${process.env.VAPI_PRIVATE_KEY}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
    cache: "no-store",
  });
}

export async function demoAssistantId(agent: AgentTemplate): Promise<string> {
  const hit = cache.get(agent.key);
  if (hit) return hit;
  const list = await vapi(`/assistant?limit=100`).then((r) => (r.ok ? r.json() : [])).catch(() => []);
  const found = (Array.isArray(list) ? list : []).find(
    (a: { metadata?: { voizoDemo?: boolean; agentKey?: string } }) => a.metadata?.voizoDemo && a.metadata?.agentKey === agent.key,
  ) as { id: string; metadata?: { voizoDemoVersion?: number } } | undefined;
  const platformKey = platformElevenLabsKey();
  const base = composeDemoAssistant(agent, { company: "", firstName: "" });
  // End-of-call reports go to our webhook so demo calls are costed per organization.
  const hook = (process.env.VAPI_WEBHOOK_URL ?? "").replace(/\/+$/, "");
  const server = hook ? { url: hook.includes("/api/webhooks/") ? hook : `${hook}/api/webhooks/vapi/end-of-call`, secret: process.env.VAPI_WEBHOOK_SECRET || process.env.VAPI_PRIVATE_KEY } : undefined;
  const body = { ...base, name: `Demo · ${agent.key}`, metadata: { ...base.metadata, voizoDemoVersion: DEMO_VERSION }, ...(server ? { server } : {}), ...(platformKey ? { credentials: [{ provider: "11labs", apiKey: platformKey }] } : {}) };
  if (found) {
    if (found.metadata?.voizoDemoVersion !== DEMO_VERSION) await vapi(`/assistant/${found.id}`, { method: "PATCH", body: JSON.stringify(body) }).catch(() => {});
    cache.set(agent.key, found.id);
    return found.id;
  }
  const r = await vapi(`/assistant`, { method: "POST", body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`Vapi refused to create the demo assistant: ${(await r.text()).slice(0, 200)}`);
  const created = (await r.json()) as { id: string };
  cache.set(agent.key, created.id);
  return created.id;
}

/** Per-call overrides for the browser: everything that varies, no secrets. */
export function demoOverrides(agent: AgentTemplate, input: DemoInput, extra: { maxDurationSeconds?: number; publicDemo?: boolean; orgId?: string } = {}) {
  const a = composeDemoAssistant(agent, input);
  return {
    firstMessage: a.firstMessage,
    firstMessageMode: a.firstMessageMode,
    model: a.model,
    voice: a.voice,
    endCallMessage: a.endCallMessage,
    ...(extra.maxDurationSeconds ? { maxDurationSeconds: extra.maxDurationSeconds } : {}),
    metadata: { voizoDemo: true, agentKey: agent.key, company: input.company, firstName: input.firstName, ...(extra.publicDemo ? { voizoPublicDemo: true } : {}), ...(extra.orgId ? { orgId: extra.orgId } : {}) },
  };
}

/** How many public demo calls Vapi has seen since midnight UTC (the global daily cap reads this). */
export async function publicDemoCallsToday(): Promise<number> {
  const since = new Date();
  since.setUTCHours(0, 0, 0, 0);
  const r = await vapi(`/call?limit=100&createdAtGt=${since.toISOString()}`).catch(() => null);
  if (!r || !r.ok) return 0;
  const list = (await r.json().catch(() => [])) as { metadata?: { voizoPublicDemo?: boolean } }[];
  return (Array.isArray(list) ? list : []).filter((c) => c.metadata?.voizoPublicDemo).length;
}
