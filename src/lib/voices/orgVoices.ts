import { getOrgIntegration } from "../integrations/store";
import { VOICE_OPTIONS } from "../scriptEngine/voices";

// Voices an organization can put on its agents: the VOIZO library (VOICE_OPTIONS) plus, when
// the org has connected ElevenLabs, every voice in its own ElevenLabs account. Server-only.

export interface VoiceChoice {
  voiceId: string;
  label: string;
  /** "library" = VOIZO's curated list; "custom" = the organization's ElevenLabs account. */
  source: "library" | "custom";
  previewUrl?: string | null;
  category?: string | null;
}

interface ElevenVoice {
  voice_id: string;
  name: string;
  category?: string;
  preview_url?: string;
  labels?: Record<string, string>;
}

const cache = new Map<string, { at: number; voices: VoiceChoice[] }>();
const TTL_MS = 5 * 60_000;

export function libraryVoices(): VoiceChoice[] {
  return VOICE_OPTIONS.map((v) => ({ voiceId: v.voiceId, label: v.label, source: "library" as const }));
}

/** The org's ElevenLabs API key, or null when not connected. */
export async function orgElevenLabsKey(orgId: string): Promise<string | null> {
  const integ = await getOrgIntegration<{ apiKey: string }>(orgId, "elevenlabs");
  return integ?.credentials.apiKey ?? null;
}

/** Voices from the org's own ElevenLabs account (cached 5 min). [] when not connected or on error. */
export async function customVoices(orgId: string, opts: { force?: boolean } = {}): Promise<{ voices: VoiceChoice[]; connected: boolean; error?: string }> {
  const key = await orgElevenLabsKey(orgId);
  if (!key) return { voices: [], connected: false };
  const hit = cache.get(orgId);
  if (!opts.force && hit && Date.now() - hit.at < TTL_MS) return { voices: hit.voices, connected: true };
  try {
    const r = await fetch("https://api.elevenlabs.io/v1/voices", { headers: { "xi-api-key": key }, cache: "no-store" });
    if (!r.ok) return { voices: hit?.voices ?? [], connected: true, error: r.status === 401 ? "ElevenLabs rejected the connected API key" : `ElevenLabs answered ${r.status}` };
    const j = (await r.json()) as { voices?: ElevenVoice[] };
    const voices: VoiceChoice[] = (j.voices ?? []).map((v) => ({
      voiceId: v.voice_id,
      label: v.labels?.accent || v.labels?.gender ? `${v.name} — ${[v.labels?.gender, v.labels?.accent].filter(Boolean).join(", ")}` : v.name,
      source: "custom" as const,
      previewUrl: v.preview_url ?? null,
      category: v.category ?? null,
    }));
    cache.set(orgId, { at: Date.now(), voices });
    return { voices, connected: true };
  } catch (e) {
    return { voices: hit?.voices ?? [], connected: true, error: e instanceof Error ? e.message : "Could not reach ElevenLabs" };
  }
}

/** voiceCloneExtras() for the signed-in request's organization; empty when signed out or on any error. */
export async function voiceExtrasForRequest(): Promise<Awaited<ReturnType<typeof voiceCloneExtras>>> {
  try {
    const { getTenant } = await import("../tenant");
    const tenant = await getTenant();
    return await voiceCloneExtras(tenant?.org?.id);
  } catch {
    return { allowedVoiceIds: [] };
  }
}

/**
 * What a Vapi assistant clone needs so a custom voice works: the extra allowed voice ids and
 * the org's ElevenLabs credential to attach inline (`credentials` on the assistant). Both empty
 * when the org hasn't connected ElevenLabs.
 */
export async function voiceCloneExtras(orgId: string | null | undefined): Promise<{ allowedVoiceIds: string[]; voiceCredentials?: { provider: "11labs"; apiKey: string } }> {
  if (!orgId) return { allowedVoiceIds: [] };
  const key = await orgElevenLabsKey(orgId);
  if (!key) return { allowedVoiceIds: [] };
  const { voices } = await customVoices(orgId);
  return { allowedVoiceIds: voices.map((v) => v.voiceId), voiceCredentials: { provider: "11labs", apiKey: key } };
}
