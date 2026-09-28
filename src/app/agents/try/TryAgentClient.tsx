"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AlertCircle, Headphones, Loader2, Mic, MicOff, Phone, PhoneOff, Play, RotateCcw, Sparkles } from "lucide-react";
import { SectionTick } from "../../analytics/SectionIsland";
import { useOrg } from "@/lib/orgContext";
import { useVapiWebCall } from "@/lib/useVapiWebCall";
import { useVoiceOptions } from "@/lib/useVoiceOptions";
import type { GalleryAgent } from "@/components/AgentGallery";

const PRIMARY = "#4d90f0";

export default function TryAgentClient() {
  const org = useOrg();
  const router = useRouter();
  const params = useSearchParams();
  const [agents, setAgents] = useState<GalleryAgent[] | null>(null);
  const [selected, setSelected] = useState<string>(params.get("agent") ?? "appointment-reminder");
  const [firstName, setFirstName] = useState("");
  const [company, setCompany] = useState("");
  const [voiceId, setVoiceId] = useState("");
  const [preparing, setPreparing] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);
  const voices = useVoiceOptions();
  const call = useVapiWebCall();
  const transcriptRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/agents", { cache: "no-store" }).then(async (r) => { if (r.ok) setAgents(((await r.json()).agents ?? []) as GalleryAgent[]); }).catch(() => {});
  }, []);
  useEffect(() => { if (org.org?.name && !company) setCompany(org.org.name); }, [org.org?.name, company]);
  useEffect(() => { transcriptRef.current?.scrollTo({ top: transcriptRef.current.scrollHeight, behavior: "smooth" }); }, [call.transcript]);

  const agent = useMemo(() => agents?.find((a) => a.key === selected) ?? null, [agents, selected]);
  const inCall = call.status === "connecting" || call.status === "live" || call.status === "mic";

  const pick = useCallback((key: string) => {
    if (inCall) return;
    setSelected(key);
    router.replace(`/agents/try?agent=${key}`);
  }, [inCall, router]);

  async function startCall(e: FormEvent) {
    e.preventDefault();
    if (!agent) return;
    setApiError(null);
    setPreparing(true);
    try {
      const r = await fetch("/api/agents/demo-call", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: agent.key, company, firstName, voiceId: voiceId || undefined }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "Could not prepare the call");
      await call.start(j.publicKey, j.assistant);
    } catch (err) {
      setApiError(err instanceof Error ? err.message : "Could not prepare the call");
    } finally {
      setPreparing(false);
    }
  }

  const mm = String(Math.floor(call.seconds / 60)).padStart(2, "0");
  const ss = String(call.seconds % 60).padStart(2, "0");
  const inputCls = "h-11 w-full rounded-xl border border-[var(--border-2)] bg-[var(--bg-elevated)] px-3.5 text-sm text-[var(--text-1)] outline-none placeholder:text-[var(--text-4)] focus:border-[#4d90f0] focus:ring-4 focus:ring-[#4d90f0]/15 disabled:opacity-60";

  return (
    <div className="p-4 max-w-[1200px] mx-auto w-full grid grid-cols-[minmax(0,1fr)] gap-4">
      <div className="min-w-0">
        <div className="flex items-center gap-2.5">
          <SectionTick color="#4d90f0" />
          <h1 className="text-lg font-semibold tracking-tight text-[var(--text-1)]">Try an agent</h1>
        </div>
        <p className="mt-1 text-xs text-[var(--text-3)]">Pick an agent, enter your name and your brand, and talk to it right here in the browser. No setup, no phone number: the agent calls <em>you</em>.</p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        {/* ── Agent picker ── */}
        <section className="rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-4">
          <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--text-3)]">1 · Choose an agent</p>
          {!agents ? (
            <div className="grid gap-2 sm:grid-cols-2">{Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-16 animate-pulse rounded-xl bg-[var(--bg-elevated)]" />)}</div>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2 max-h-[62vh] overflow-y-auto pr-1">
              {agents.map((a) => {
                const on = a.key === selected;
                return (
                  <button key={a.key} type="button" onClick={() => pick(a.key)} disabled={inCall}
                    className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition disabled:opacity-60 ${on ? "border-primary/60 bg-primary/10" : "border-[var(--border)] bg-[var(--bg-elevated)] hover:border-[var(--border-2)]"}`}>
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white" style={{ background: a.gender === "female" ? "linear-gradient(145deg,#e46fa5,#8b6cf0)" : "linear-gradient(145deg,#4d90f0,#22b8a7)" }}>{a.name[0]}</span>
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold text-[var(--text-1)]">{a.name} <span className="font-normal text-[var(--text-3)]">· {a.role}</span></span>
                      <span className="block truncate text-[11px] text-[var(--text-3)]">{a.industry}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </section>

        {/* ── Call panel ── */}
        <section className="rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-4 flex flex-col">
          <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--text-3)]">2 · Your details, then talk</p>
          {agent && (
            <div className="mb-4 flex items-start gap-3 rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] p-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white" style={{ background: agent.gender === "female" ? "linear-gradient(145deg,#e46fa5,#8b6cf0)" : "linear-gradient(145deg,#4d90f0,#22b8a7)" }}>{agent.name[0]}</span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-[var(--text-1)]">{agent.name} — {agent.role}</p>
                <p className="text-xs text-[var(--text-3)]">{agent.tagline}</p>
              </div>
              {agent.sampleUrl && call.status === "idle" && (
                <a href={agent.sampleUrl} target="_blank" rel="noreferrer" className="inline-flex h-8 shrink-0 items-center gap-1 rounded-lg border border-[var(--border)] px-2 text-[11px] text-[var(--text-2)] hover:text-[var(--text-1)]" title="Hear a recorded sample"><Play size={11} /> Sample</a>
              )}
            </div>
          )}

          {call.status === "idle" || call.status === "error" || call.status === "ended" ? (
            <form onSubmit={startCall} className="grid gap-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label htmlFor="try-name" className="mb-1.5 block text-xs font-medium text-[var(--text-2)]">Your first name</label>
                  <input id="try-name" required maxLength={40} value={firstName} onChange={(e) => setFirstName(e.target.value)} placeholder="e.g. Chris" className={inputCls} />
                </div>
                <div>
                  <label htmlFor="try-company" className="mb-1.5 block text-xs font-medium text-[var(--text-2)]">Brand / company the agent calls for</label>
                  <input id="try-company" required maxLength={80} value={company} onChange={(e) => setCompany(e.target.value)} placeholder="e.g. Riverside Dental" className={inputCls} />
                </div>
              </div>
              <div>
                <label htmlFor="try-voice" className="mb-1.5 block text-xs font-medium text-[var(--text-2)]">Voice <span className="text-[var(--text-4)]">(optional)</span></label>
                <select id="try-voice" value={voiceId} onChange={(e) => setVoiceId(e.target.value)} className={`${inputCls} [color-scheme:dark]`}>
                  <option value="">{agent ? `${agent.name}'s own voice` : "Agent's own voice"}</option>
                  {voices.custom.length > 0 && <optgroup label="Your ElevenLabs voices">{voices.custom.map((v) => <option key={v.voiceId} value={v.voiceId}>{v.label}</option>)}</optgroup>}
                  <optgroup label="VOIZO voice library">{voices.library.map((v) => <option key={v.voiceId} value={v.voiceId}>{v.label}</option>)}</optgroup>
                </select>
              </div>
              {(apiError || call.error) && (
                <div role="alert" className="flex items-start gap-2.5 rounded-xl border border-red-500/25 bg-red-500/10 px-3.5 py-3 text-sm text-red-300"><AlertCircle size={16} className="mt-0.5 shrink-0" /><span>{apiError ?? call.error}</span></div>
              )}
              {call.status === "ended" && !call.error && (
                <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/10 px-3.5 py-3 text-sm text-emerald-200">Call ended after {mm}:{ss}. Try another agent, or the same one with different answers.</div>
              )}
              <button type="submit" disabled={preparing || !agent || !firstName.trim() || !company.trim()} className="mt-1 inline-flex h-12 items-center justify-center gap-2 rounded-xl text-sm font-semibold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60" style={{ background: PRIMARY, boxShadow: `0 8px 24px ${PRIMARY}33` }}>
                {preparing ? <Loader2 size={16} className="animate-spin" /> : <Phone size={16} />} {call.status === "ended" ? "Call again" : "Start the call"}
              </button>
              <p className="flex items-center gap-1.5 text-[11px] text-[var(--text-4)]"><Headphones size={12} /> Use headphones if you can; your browser will ask for the microphone first.</p>
            </form>
          ) : (
            <div className="flex flex-1 flex-col gap-3">
              {/* status row */}
              <div className="flex flex-wrap items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] px-3.5 py-3">
                <span className={`relative flex h-9 w-9 items-center justify-center rounded-full ${call.status === "live" ? "bg-emerald-500/15 text-emerald-400" : "bg-amber-500/15 text-amber-300"}`}>
                  {call.status === "live" && <span className="lp-ping absolute inset-0 rounded-full bg-emerald-400/40" />}
                  {call.status === "mic" ? <Mic size={16} /> : call.status === "connecting" ? <Loader2 size={16} className="animate-spin" /> : <Phone size={16} />}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-[var(--text-1)]">{call.status === "mic" ? "Checking your microphone…" : call.status === "connecting" ? "Connecting to the agent…" : call.assistantSpeaking ? `${agent?.name ?? "Agent"} is speaking` : "Listening — go ahead and talk"}</p>
                  <p className="text-[11px] text-[var(--text-3)]">{call.mic.deviceLabel ? `Mic: ${call.mic.deviceLabel}` : "Mic: waiting for permission"}</p>
                </div>
                <span className="font-mono text-sm text-[var(--text-2)]">{mm}:{ss}</span>
                <button type="button" onClick={call.stop} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-red-600 px-3 text-xs font-semibold text-white hover:bg-red-500"><PhoneOff size={13} /> End</button>
              </div>
              {/* meters */}
              <div className="grid grid-cols-2 gap-3 text-[11px] text-[var(--text-3)]">
                <div>
                  <div className="mb-1 flex items-center gap-1.5">{call.mic.ok ? <Mic size={12} /> : <MicOff size={12} />} You</div>
                  <div className="h-2 overflow-hidden rounded-full bg-[var(--bg-elevated)]"><div className="h-full rounded-full bg-emerald-400 transition-[width] duration-75" style={{ width: `${Math.round(call.mic.level * 100)}%` }} /></div>
                </div>
                <div>
                  <div className="mb-1 flex items-center gap-1.5"><Sparkles size={12} /> {agent?.name ?? "Agent"}</div>
                  <div className="h-2 overflow-hidden rounded-full bg-[var(--bg-elevated)]"><div className="h-full rounded-full transition-[width] duration-75" style={{ width: `${Math.round(Math.min(1, call.assistantLevel * 3) * 100)}%`, background: PRIMARY }} /></div>
                </div>
              </div>
              {call.status === "live" && call.mic.level < 0.02 && call.seconds > 6 && (
                <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-200">Your microphone level is flat. If the agent can&apos;t hear you, check the input device in your browser or system settings.</p>
              )}
              {/* transcript */}
              <div ref={transcriptRef} className="min-h-[220px] max-h-[40vh] flex-1 space-y-2 overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--bg-app)] p-3">
                {call.transcript.length === 0 && <p className="text-xs text-[var(--text-4)]">The conversation will appear here as you speak.</p>}
                {call.transcript.map((l, i) => (
                  <div key={i} className={`flex ${l.role === "assistant" ? "justify-start" : "justify-end"}`}>
                    <p className={`max-w-[85%] rounded-2xl px-3 py-2 text-[13px] leading-snug ${l.role === "assistant" ? "bg-[var(--bg-elevated)] text-[var(--text-1)] rounded-bl-md" : "text-white rounded-br-md"} ${l.final ? "" : "opacity-70"}`} style={l.role === "assistant" ? undefined : { background: PRIMARY }}>{l.text}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
          {call.status === "ended" && (
            <button type="button" onClick={call.reset} className="mt-3 inline-flex items-center gap-1.5 self-start text-xs text-[var(--text-3)] hover:text-[var(--text-1)]"><RotateCcw size={12} /> Clear</button>
          )}
        </section>
      </div>
    </div>
  );
}
