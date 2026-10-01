import { elevenLabsUsd, recordUsage } from "./usage";

// Demo calls (landing page, Try an agent) have no calls_v2 row. When Vapi posts their
// end-of-call report, the cost is recorded as usage_events against the organization that ran
// the demo (null for anonymous landing-page visitors).

export async function recordDemoCallUsage(message: Record<string, unknown>, call: Record<string, unknown>, meta: Record<string, unknown>): Promise<void> {
  const cost = Number(message.cost ?? call.cost ?? 0) || 0;
  const breakdown = (message.costBreakdown ?? call.costBreakdown ?? {}) as Record<string, unknown>;
  const chars = Number(breakdown.ttsCharacters ?? 0) || 0;
  const orgId = typeof meta.orgId === "string" ? meta.orgId : null;
  const ref = typeof call.id === "string" ? call.id : null;
  const seconds = Number(message.durationSeconds ?? 0) || null;
  await recordUsage({
    orgId, provider: "vapi", kind: "demo_call", units: seconds, usd: cost, ref,
    meta: { agentKey: meta.agentKey ?? null, public: Boolean(meta.voizoPublicDemo), endedReason: message.endedReason ?? null, breakdown },
  });
  // With our own ElevenLabs key Vapi bills no TTS; estimate it from the characters spoken.
  if (chars > 0 && !(Number(breakdown.tts ?? 0) > 0)) {
    await recordUsage({ orgId, provider: "elevenlabs", kind: "demo_call_tts", units: chars, usd: elevenLabsUsd(chars), ref });
  }
}
