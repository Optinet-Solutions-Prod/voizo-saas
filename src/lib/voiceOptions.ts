// Voice ID → friendly name. SINGLE SOURCE OF TRUTH — the campaign wizard (StepAgent)
// and the analytics dashboard both import this. Ported from page-classic; keep in sync
// with the voices configured in Vapi. Used ONLY for display (never sent to clone — R3).

// SaaS (2026-09-25): mirrors the script-builder library (ElevenLabs premade voices) plus the
// legacy ids, so old campaign rows still get a name.
export const VOICE_OPTIONS: ReadonlyArray<{ id: string; name: string }> = [
  { id: "cjVigY5qzO86Huf0OWal", name: "Eric – Smooth, trustworthy" },
  { id: "EXAVITQu4vr4xnSDxMaL", name: "Sarah – Mature, reassuring" },
  { id: "iP95p4xoKVk53GoZ742B", name: "Chris – Charming, down-to-earth" },
  { id: "hpp4J3VqNfWAUOO0d1Us", name: "Bella – Professional, bright" },
  { id: "nPczCjzI2devNBz1zQrb", name: "Brian – Deep, resonant" },
  { id: "XrExE9yKIg1WjnnlVkGX", name: "Matilda – Knowledgeable, professional" },
  { id: "bIHbv24MWmeRgasZH58o", name: "Will – Relaxed optimist" },
  { id: "cgSgspJ2msm6clMCkdW9", name: "Jessica – Playful, warm" },
  { id: "CwhRBWXzGAHq8TQ4Fs17", name: "Roger – Laid-back, casual" },
  { id: "onwK4e9ZLuTAKqWW03F9", name: "Daniel – Steady broadcaster" },
  { id: "Xb7hH8MSUJpSbSDYk0k2", name: "Alice – Clear, engaging" },
  { id: "JBFqnCBsd6RMkjVDRZzb", name: "George – Warm storyteller" },
  { id: "pFZP5JQG7iQjIQuC4Bku", name: "Lily – Velvety, composed" },
  { id: "IKne3meq5aSn9XLyUdCD", name: "Charlie – Confident, energetic" },
  // legacy (pre-SaaS) ids
  { id: "3jR9BuQAOPMWUjWpi0ll", name: "Stephen – Sales and Customer Service" },
  { id: "UgBBYS2sOqTuMpoF3BR0", name: "Mark – Dynamic, Balanced and Emotional" },
  { id: "6YQMyaUWlj0VX652cY1C", name: "Mark – Natural Conversations" },
  { id: "2zGvynULFssveGrcP8hi", name: "Jackson – American Tech Sales Rep" },
  { id: "YaarrMwvJxVUpjbZ2RpC", name: "George – Natural, Full and Confident" },
  { id: "pHqSZYhjNK8nDCPRglTL", name: "Alex – Professional" },
  { id: "1IthILLNX448pH19aMvC", name: "Matthew Logovik" },
  { id: "pNInz6obpgDQGcFmaJgB", name: "Adam – Default" },
];

const BY_ID = new Map(VOICE_OPTIONS.map((v) => [v.id, v.name]));

/**
 * SaaS (2026-09-24): the organization's own ElevenLabs voices (and the script-builder library)
 * register their names here once loaded (useVoiceOptions), so voiceName() can label them too.
 */
export function registerVoiceNames(voices: { id: string; name: string }[]): void {
  for (const v of voices) if (!BY_ID.has(v.id)) BY_ID.set(v.id, v.name);
}

/** Friendly voice name for a voice_id. `short` returns just the persona (text before
 *  the first dash) — e.g. "Stephen". Returns null for null/unknown ids (caller falls back). */
export function voiceName(voiceId: string | null | undefined, opts?: { short?: boolean }): string | null {
  if (!voiceId) return null;
  const full = BY_ID.get(voiceId);
  if (!full) return null;
  return opts?.short ? full.split(/[–-]/)[0].trim() : full;
}
