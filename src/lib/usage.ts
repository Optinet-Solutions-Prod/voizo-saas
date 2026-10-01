// Spend attribution: every paid call to Vapi / OpenAI / ElevenLabs made by the app records a
// usage_events row with the organization it was for (null = public demo / platform work).
// Campaign call costs already live on calls_v2 (vapi_cost_usd, openai_cost_usd) and are joined
// by org through campaigns_v2 in the org_cost_summary() RPC.

const db = async () => (await import("./supabaseServer")).supabaseService;

export type UsageProvider = "vapi" | "openai" | "elevenlabs" | "other";

export interface UsageEvent {
  orgId?: string | null;
  provider: UsageProvider;
  /** demo_call | agent_match | call_summary | qa_judge | sample_tts | … */
  kind: string;
  /** seconds, tokens or characters — whatever the provider bills on. */
  units?: number | null;
  usd: number;
  /** Vapi call id, OpenAI request id, … */
  ref?: string | null;
  meta?: Record<string, unknown> | null;
}

export async function recordUsage(ev: UsageEvent): Promise<void> {
  try {
    const { error } = await (await db()).from("usage_events").insert({
      org_id: ev.orgId ?? null,
      provider: ev.provider,
      kind: ev.kind,
      units: ev.units ?? null,
      usd: Math.round(ev.usd * 1e6) / 1e6,
      ref: ev.ref ?? null,
      meta: ev.meta ?? null,
    });
    if (error) throw error;
  } catch (e) {
    console.warn("[usage] not recorded:", (e as Error)?.message ?? e);
  }
}

/** USD per million tokens, [input, output]. Update when OpenAI changes list prices. */
const OPENAI_PRICES: Record<string, [number, number]> = {
  "gpt-4.1": [2, 8],
  "gpt-4.1-mini": [0.4, 1.6],
  "gpt-4.1-nano": [0.1, 0.4],
  "gpt-4o": [2.5, 10],
  "gpt-4o-mini": [0.15, 0.6],
};

export function openaiUsd(model: string, promptTokens: number, completionTokens: number): number {
  const p = OPENAI_PRICES[model] ?? OPENAI_PRICES["gpt-4.1-mini"];
  return (promptTokens * p[0] + completionTokens * p[1]) / 1e6;
}

/** Record one chat completion from its `usage` block. */
export async function recordOpenAI(opts: { orgId?: string | null; kind: string; model: string; usage?: { prompt_tokens?: number; completion_tokens?: number } | null; ref?: string | null }): Promise<void> {
  const pt = opts.usage?.prompt_tokens ?? 0;
  const ct = opts.usage?.completion_tokens ?? 0;
  await recordUsage({ orgId: opts.orgId, provider: "openai", kind: opts.kind, units: pt + ct, usd: openaiUsd(opts.model, pt, ct), ref: opts.ref, meta: { model: opts.model, prompt_tokens: pt, completion_tokens: ct } });
}

/** ElevenLabs bills per character; the rate depends on the plan (env ELEVENLABS_USD_PER_1K_CHARS, default 0.20). */
export function elevenLabsUsd(characters: number): number {
  return (characters / 1000) * Number(process.env.ELEVENLABS_USD_PER_1K_CHARS ?? 0.2);
}
