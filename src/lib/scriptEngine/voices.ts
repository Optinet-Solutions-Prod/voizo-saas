// The VOIZO voice library.
//
// SAMPLE_VOICES (2026-09-29, Chris): every pre-built agent, sample clip and demo call uses ONE
// male and ONE female voice — "Mark – Natural Conversations" and "Hope – Natural, Clear and
// Calm", both ElevenLabs Voice Library voices, added to the VOIZO ElevenLabs account. Vapi
// synthesises them with the platform key attached to each assistant (ELEVEN_LABS_KEY), not
// Vapi's own ElevenLabs.
//
// ElevenLabs only serves library voices through the API on a paid plan ("Free users cannot use
// library voices via the API", HTTP 402). While the account is on the free tier the pair falls
// back to two premade voices so calls and samples keep working. Flip with
// NEXT_PUBLIC_VOICE_PAIR=library (Vercel + .env.local) once the plan is upgraded, then run
// `node scripts/generate-agent-samples.mjs --provider elevenlabs --force`.
const LIBRARY_PAIR = {
  male:   { label: "Mark – Natural Conversations (male)",      voiceId: "UgBBYS2sOqTuMpoF3BR0" },
  female: { label: "Hope – Natural, Clear and Calm (female)",  voiceId: "OYTbf65OHHFELVut7v2H" },
} as const;
const PREMADE_PAIR = {
  male:   { label: "Eric – Smooth, trustworthy (male, stand-in for Mark)",  voiceId: "cjVigY5qzO86Huf0OWal" },
  female: { label: "Sarah – Mature, reassuring (female, stand-in for Hope)", voiceId: "EXAVITQu4vr4xnSDxMaL" },
} as const;

export const VOICE_PAIR_MODE: "library" | "premade" = process.env.NEXT_PUBLIC_VOICE_PAIR === "library" ? "library" : "premade";
export const SAMPLE_VOICES: { male: { label: string; voiceId: string }; female: { label: string; voiceId: string } } =
  VOICE_PAIR_MODE === "library" ? LIBRARY_PAIR : PREMADE_PAIR;

// VOICE_OPTIONS is what the pickers offer: the pair first, then ElevenLabs "premade" voices
// (public ids every account can use). voiceIds must stay unique (they are <option> values).
export const VOICE_OPTIONS = [
  { label: SAMPLE_VOICES.male.label,   provider: "11labs", voiceId: SAMPLE_VOICES.male.voiceId },
  { label: SAMPLE_VOICES.female.label, provider: "11labs", voiceId: SAMPLE_VOICES.female.voiceId },
  ...(VOICE_PAIR_MODE === "library"
    ? [
        { label: "Eric – Smooth, trustworthy (US male)",    provider: "11labs", voiceId: "cjVigY5qzO86Huf0OWal" },
        { label: "Sarah – Mature, reassuring (US female)",  provider: "11labs", voiceId: "EXAVITQu4vr4xnSDxMaL" },
      ]
    : []),
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
