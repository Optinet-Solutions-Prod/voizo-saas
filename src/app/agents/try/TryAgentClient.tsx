"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AlertCircle, Headphones, Loader2, Phone, Play, RotateCcw } from "lucide-react";
import { SectionTick } from "../../analytics/SectionIsland";
import { useOrg } from "@/lib/orgContext";
import { useVapiWebCall } from "@/lib/useVapiWebCall";
import { useVoiceOptions } from "@/lib/useVoiceOptions";
import type { GalleryAgent } from "@/components/AgentGallery";
import LiveCallPanel, { formatSeconds } from "@/components/LiveCallPanel";

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

  useEffect(() => {
    fetch("/api/agents", { cache: "no-store" }).then(async (r) => { if (r.ok) setAgents(((await r.json()).agents ?? []) as GalleryAgent[]); }).catch(() => {});
  }, []);
  useEffect(() => { if (org.org?.name && !company) setCompany(org.org.name); }, [org.org?.name, company]);

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
      await call.start(j.publicKey, j.assistantId, j.overrides);
    } catch (err) {
      setApiError(err instanceof Error ? err.message : "Could not prepare the call");
    } finally {
      setPreparing(false);
    }
  }

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
                <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/10 px-3.5 py-3 text-sm text-emerald-200">Call ended after {formatSeconds(call.seconds)}. Try another agent, or the same one with different answers.</div>
              )}
              <button type="submit" disabled={preparing || !agent || !firstName.trim() || !company.trim()} className="mt-1 inline-flex h-12 items-center justify-center gap-2 rounded-xl text-sm font-semibold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60" style={{ background: PRIMARY, boxShadow: `0 8px 24px ${PRIMARY}33` }}>
                {preparing ? <Loader2 size={16} className="animate-spin" /> : <Phone size={16} />} {call.status === "ended" ? "Call again" : "Start the call"}
              </button>
              <p className="flex items-center gap-1.5 text-[11px] text-[var(--text-4)]"><Headphones size={12} /> Use headphones if you can; your browser will ask for the microphone first.</p>
            </form>
          ) : (
            <LiveCallPanel call={call} agentName={agent?.name ?? "Agent"} />
          )}
          {call.status === "ended" && (
            <button type="button" onClick={call.reset} className="mt-3 inline-flex items-center gap-1.5 self-start text-xs text-[var(--text-3)] hover:text-[var(--text-1)]"><RotateCcw size={12} /> Clear</button>
          )}
        </section>
      </div>
    </div>
  );
}
