"use client";

import { useEffect, useState } from "react";
import { VOICE_OPTIONS } from "@/lib/scriptEngine/voices";
import { registerVoiceNames } from "@/lib/voiceOptions";

// The voices this organization can pick: VOIZO's library plus the org's own ElevenLabs voices
// (Settings → Integrations → ElevenLabs). Falls back to the library while loading / signed out.

export interface VoiceOption {
  voiceId: string;
  label: string;
  source: "library" | "custom";
  previewUrl?: string | null;
}

interface VoiceData { library: VoiceOption[]; custom: VoiceOption[]; connected: boolean; error?: string }

const LIBRARY: VoiceOption[] = VOICE_OPTIONS.map((v) => ({ voiceId: v.voiceId, label: v.label, source: "library" }));

let cached: VoiceData | null = null;

async function load(refresh: boolean): Promise<VoiceData | null> {
  try {
    const r = await fetch(`/api/org/voices${refresh ? "?refresh=1" : ""}`, { cache: "no-store" });
    if (!r.ok) return null;
    const j = await r.json();
    cached = { library: j.library ?? LIBRARY, custom: j.custom ?? [], connected: !!j.connected, error: j.error };
    registerVoiceNames([...cached.library, ...cached.custom].map((v) => ({ id: v.voiceId, name: v.label })));
    return cached;
  } catch {
    return null;
  }
}

export function useVoiceOptions(): VoiceData & { all: VoiceOption[]; loaded: boolean; refresh: () => Promise<void> } {
  const [state, setState] = useState<VoiceData | null>(cached);

  useEffect(() => {
    if (cached) return;
    let alive = true;
    load(false).then((d) => { if (alive && d) setState(d); });
    return () => { alive = false; };
  }, []);

  const library = state?.library ?? LIBRARY;
  const custom = state?.custom ?? [];
  return {
    library,
    custom,
    all: [...custom, ...library],
    connected: state?.connected ?? false,
    error: state?.error,
    loaded: !!state,
    refresh: async () => { const d = await load(true); if (d) setState(d); },
  };
}
