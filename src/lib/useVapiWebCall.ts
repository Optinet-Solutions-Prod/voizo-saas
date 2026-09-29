"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { vapiErrorText } from "@/lib/scriptEngine/vapi";

// A browser call to Vapi with the checks a demo needs: microphone permission and level BEFORE
// dialing (the failure we saw was "assistant did not receive customer audio" — the call
// connected, the browser sent silence), live transcript, who is speaking, and plain errors.

export type CallStatus = "idle" | "mic" | "connecting" | "live" | "ended" | "error";

export interface TranscriptLine {
  role: "assistant" | "user";
  text: string;
  final: boolean;
}

export interface MicState {
  ok: boolean;
  level: number; // 0..1, live while checking / in call
  deviceLabel: string | null;
  error: string | null;
}

const NO_AUDIO_HINT = "The call was ended by the server right after connecting. That happens when no microphone audio reaches it: check the mic isn't muted or in use by another app (Teams, Zoom), pick the right input device in the browser, then try again.";

export function explainVapiError(err: unknown): string {
  const text = vapiErrorText(err, "The call could not be started.");
  if (/did-not-receive-customer-audio|customer-audio/i.test(text)) return "Vapi didn't receive any sound from your microphone. Allow the microphone for this site and check the input device, then try again.";
  if (/permission|NotAllowedError|denied/i.test(text)) return "Microphone access was blocked. Click the lock icon in the address bar, allow the microphone, and reload.";
  if (/NotFoundError|no audio|not found/i.test(text)) return "No microphone was found. Plug one in or pick a different input device.";
  if (/meeting has ended|ejected|room was deleted|Exiting meeting/i.test(text)) return NO_AUDIO_HINT;
  if (/401|unauthori[sz]ed|public key/i.test(text)) return "The Vapi public key is missing or wrong on this deployment.";
  if (/Failed to fetch|NetworkError|ERR_|load failed|blocked/i.test(text)) return "The browser couldn't reach Vapi's call service (api.vapi.ai / daily.co). An ad-blocker, privacy extension, VPN or firewall is the usual cause — try a normal Chrome window without extensions.";
  if (/daily|room|join/i.test(text)) return `The audio room couldn't be joined (${text}). If this keeps happening, an extension, VPN or firewall may be blocking daily.co.`;
  return text;
}

export function useVapiWebCall() {
  const [status, setStatus] = useState<CallStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<TranscriptLine[]>([]);
  const [assistantSpeaking, setAssistantSpeaking] = useState(false);
  const [assistantLevel, setAssistantLevel] = useState(0);
  const [mic, setMic] = useState<MicState>({ ok: false, level: 0, deviceLabel: null, error: null });
  const [seconds, setSeconds] = useState(0);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const vapiRef = useRef<any>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const timerRef = useRef<number | null>(null);
  const liveRef = useRef(false);

  const stopMeter = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    ctxRef.current?.close().catch(() => {});
    ctxRef.current = null;
  }, []);

  /** Ask for the mic and watch its level for a moment so the user sees it works. */
  const checkMicrophone = useCallback(async (): Promise<boolean> => {
    stopMeter();
    setStatus("mic");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const label = stream.getAudioTracks()[0]?.label ?? null;
      const ctx = new AudioContext();
      ctxRef.current = ctx;
      const src = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      src.connect(analyser);
      const buf = new Uint8Array(analyser.frequencyBinCount);
      let peak = 0;
      const started = performance.now();
      await new Promise<void>((resolve) => {
        const tick = () => {
          analyser.getByteTimeDomainData(buf);
          let sum = 0;
          for (let i = 0; i < buf.length; i++) { const v = (buf[i] - 128) / 128; sum += v * v; }
          const rms = Math.sqrt(sum / buf.length);
          const level = Math.min(1, rms * 6);
          peak = Math.max(peak, level);
          setMic({ ok: true, level, deviceLabel: label, error: null });
          if (performance.now() - started < 1800) rafRef.current = requestAnimationFrame(tick);
          else resolve();
        };
        tick();
      });
      // Keep metering during the call so the presenter can see the mic is alive.
      const keep = () => {
        if (!streamRef.current) return;
        analyser.getByteTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) { const v = (buf[i] - 128) / 128; sum += v * v; }
        setMic((m) => ({ ...m, level: Math.min(1, Math.sqrt(sum / buf.length) * 6) }));
        rafRef.current = requestAnimationFrame(keep);
      };
      rafRef.current = requestAnimationFrame(keep);
      void peak;
      return true;
    } catch (e) {
      const msg = explainVapiError(e);
      setMic({ ok: false, level: 0, deviceLabel: null, error: msg });
      setError(msg);
      setStatus("error");
      return false;
    }
  }, [stopMeter]);

  const stop = useCallback(() => {
    try { vapiRef.current?.stop(); } catch { /* already stopped */ }
    if (timerRef.current) window.clearInterval(timerRef.current);
    timerRef.current = null;
    stopMeter();
    setAssistantSpeaking(false);
    setStatus((s) => (s === "live" || s === "connecting" ? "ended" : s));
  }, [stopMeter]);

  /** Start a call: a transient assistant config, or an assistant id plus per-call overrides. */
  const start = useCallback(async (publicKey: string, assistant: Record<string, unknown> | string, overrides?: Record<string, unknown>) => {
    setError(null);
    setTranscript([]);
    setSeconds(0);
    const micOk = await checkMicrophone();
    if (!micOk) return;
    setStatus("connecting");
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const Vapi = require("@vapi-ai/web").default;
      // Hand Daily the exact track that just passed the level check, so the audio it sends is
      // the audio we metered — not a second device grab that can come back silent on Windows.
      const track = streamRef.current?.getAudioTracks()[0];
      const vapi = new Vapi(publicKey, undefined, undefined, track ? { audioSource: track } : undefined);
      vapiRef.current = vapi;
      liveRef.current = false;
      vapi.on("call-start", () => {
        liveRef.current = true;
        setStatus("live");
        timerRef.current = window.setInterval(() => setSeconds((n) => n + 1), 1000);
        // Make sure Daily is actually sending our microphone; unmute if it isn't.
        try {
          const daily = vapi.getDailyCallObject?.();
          const state = daily?.participants?.().local?.tracks?.audio?.state as string | undefined;
          console.info("[vapi] local audio track", state ?? "unknown", track?.label ?? "");
          if (state && state !== "playable" && state !== "sendable" && state !== "loading") { vapi.setMuted(false); daily?.setLocalAudio?.(true); }
        } catch { /* best effort */ }
      });
      vapi.on("call-end", () => {
        liveRef.current = false;
        setStatus("ended");
        if (timerRef.current) window.clearInterval(timerRef.current);
        timerRef.current = null;
        stopMeter();
        setAssistantSpeaking(false);
      });
      vapi.on("speech-start", () => setAssistantSpeaking(true));
      vapi.on("speech-end", () => setAssistantSpeaking(false));
      vapi.on("volume-level", (v: number) => setAssistantLevel(v));
      vapi.on("message", (m: { type?: string; role?: string; transcript?: string; transcriptType?: string }) => {
        if (m?.type !== "transcript" || !m.transcript) return;
        const role = m.role === "assistant" ? "assistant" : "user";
        const final = m.transcriptType === "final";
        setTranscript((prev) => {
          const last = prev[prev.length - 1];
          // Partial transcripts replace the previous partial of the same speaker.
          if (last && last.role === role && !last.final) return [...prev.slice(0, -1), { role, text: m.transcript!, final }];
          return [...prev, { role, text: m.transcript!, final }];
        });
      });
      // The SDK reports failures through events and then resolves start() with null, so keep
      // the first real reason it gives us and show that — not a generic "no call".
      let reported: string | null = null;
      let lastStage = "";
      vapi.on("call-start-progress", (p: { stage?: string; status?: string; metadata?: Record<string, unknown> }) => {
        console.info("[vapi] start progress", p?.stage, p?.status, p?.metadata ?? "");
        if (p?.status === "failed") lastStage = `${p.stage ?? "unknown"}${p.metadata?.reason ? ` (${String(p.metadata.reason)})` : ""}${p.metadata?.error ? `: ${String(p.metadata.error)}` : ""}`;
      });
      vapi.on("error", (e: unknown) => {
        console.error("[vapi] error", e);
        const text = vapiErrorText(e, "");
        // The room vanishing during a live call is just the end of the call; before the call is
        // live it means the server hung up on us — almost always because no mic audio arrived.
        if (/meeting has ended|ejected|room was deleted|Exiting meeting/i.test(text) && liveRef.current) { setStatus("ended"); return; }
        reported = explainVapiError(e);
        setError(reported);
        setStatus("error");
        if (timerRef.current) window.clearInterval(timerRef.current);
        stopMeter();
      });
      const call = await vapi.start(assistant, overrides);
      if (!call && !reported) {
        throw new Error(
          lastStage
            ? `The call didn't start — failed at ${lastStage}.`
            : "The call didn't start. Something on this computer or network stopped the browser from reaching Vapi's call service (api.vapi.ai / daily.co): an ad-blocker or privacy extension, a VPN or corporate firewall, or a browser that blocks WebRTC. Try a normal Chrome window without extensions.",
        );
      }
    } catch (e) {
      console.error("[vapi] start failed", e);
      setError(explainVapiError(e));
      setStatus("error");
      stopMeter();
    }
  }, [checkMicrophone, stopMeter]);

  useEffect(() => () => { try { vapiRef.current?.stop(); } catch { /* noop */ } stopMeter(); if (timerRef.current) window.clearInterval(timerRef.current); }, [stopMeter]);

  const reset = useCallback(() => { stop(); setStatus("idle"); setError(null); setTranscript([]); setSeconds(0); }, [stop]);

  return { status, error, transcript, assistantSpeaking, assistantLevel, mic, seconds, start, stop, reset, checkMicrophone };
}
