// The VOIZO voice library.
//
// SAMPLE_VOICES (2026-09-29, Chris): every pre-built agent, sample clip and demo call uses ONE
// male and ONE female voice. The intended pair is "Mark – Natural Conversations"
// (UgBBYS2sOqTuMpoF3BR0) and "Hope – Natural, clear" (OYTbf65OHHFELVut7v2H); those ids live in a
// former team member's private ElevenLabs account and are NOT visible to the SaaS account yet
// (voice_not_found). Until they are shared into it, the closest premade voices stand in. To
// switch: change the two ids/labels below — nothing else references them.
//
// VOICE_OPTIONS is what the pickers offer: the pair first, then ElevenLabs "premade" voices
// (public ids every account and Vapi's built-in ElevenLabs can use).
export const SAMPLE_VOICES = {
  male:   { label: "VOIZO male — Eric (stand-in for Mark)",     voiceId: "cjVigY5qzO86Huf0OWal" },
  female: { label: "VOIZO female — Sarah (stand-in for Hope)",  voiceId: "EXAVITQu4vr4xnSDxMaL" },
} as const;

export const VOICE_OPTIONS = [
  { label: SAMPLE_VOICES.male.label,   provider: "11labs", voiceId: SAMPLE_VOICES.male.voiceId },
  { label: SAMPLE_VOICES.female.label, provider: "11labs", voiceId: SAMPLE_VOICES.female.voiceId },
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
export const DEFAULT_VOICE_ID = SAMPLE_VOICES.male.voiceId;
