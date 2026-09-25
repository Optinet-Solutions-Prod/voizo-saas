// The VOIZO voice library: ElevenLabs "premade" voices. These ids are public — every
// ElevenLabs account and Vapi's built-in ElevenLabs can use them — so agents, test calls and
// the landing-page samples all sound the same and nothing depends on a private voice account.
//
// SaaS (2026-09-25): replaced the original list, whose ids lived in a former team member's
// private ElevenLabs account and were not reachable from the SaaS accounts (401 on lookup).
// Genders/accents come from ElevenLabs' own labels. voiceIds must stay unique (they are the
// <option> values).
export const VOICE_OPTIONS = [
  { label: "Eric – Smooth, trustworthy (US male)",        provider: "11labs", voiceId: "cjVigY5qzO86Huf0OWal" },
  { label: "Sarah – Mature, reassuring (US female)",      provider: "11labs", voiceId: "EXAVITQu4vr4xnSDxMaL" },
  { label: "Chris – Charming, down-to-earth (US male)",   provider: "11labs", voiceId: "iP95p4xoKVk53GoZ742B" },
  { label: "Bella – Professional, bright (US female)",    provider: "11labs", voiceId: "hpp4J3VqNfWAUOO0d1Us" },
  { label: "Brian – Deep, resonant (US male)",            provider: "11labs", voiceId: "nPczCjzI2devNBz1zQrb" },
  { label: "Matilda – Knowledgeable, professional (US female)", provider: "11labs", voiceId: "XrExE9yKIg1WjnnlVkGX" },
  { label: "Will – Relaxed optimist (US male)",           provider: "11labs", voiceId: "bIHbv24MWmeRgasZH58o" },
  { label: "Jessica – Playful, warm (US female)",         provider: "11labs", voiceId: "cgSgspJ2msm6clMCkdW9" },
  { label: "Roger – Laid-back, casual (US male)",         provider: "11labs", voiceId: "CwhRBWXzGAHq8TQ4Fs17" },
  { label: "Daniel – Steady broadcaster (UK male)",       provider: "11labs", voiceId: "onwK4e9ZLuTAKqWW03F9" },
  { label: "Alice – Clear, engaging (UK female)",         provider: "11labs", voiceId: "Xb7hH8MSUJpSbSDYk0k2" },
  { label: "George – Warm storyteller (UK male)",         provider: "11labs", voiceId: "JBFqnCBsd6RMkjVDRZzb" },
  { label: "Lily – Velvety, composed (UK female)",        provider: "11labs", voiceId: "pFZP5JQG7iQjIQuC4Bku" },
  { label: "Charlie – Confident, energetic (AU male)",    provider: "11labs", voiceId: "IKne3meq5aSn9XLyUdCD" },
] as const;

/** Sensible default for new scripts and the base agent. */
export const DEFAULT_VOICE_ID = VOICE_OPTIONS[0].voiceId;
