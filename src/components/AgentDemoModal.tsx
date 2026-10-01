"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { AlertCircle, ArrowRight, Headphones, Loader2, Pause, Phone, Play, RotateCcw, X } from "lucide-react";
import { useVapiWebCall } from "@/lib/useVapiWebCall";
import LiveCallPanel, { formatSeconds } from "./LiveCallPanel";
import type { GalleryAgent } from "./AgentGallery";
import CallSummaryCard from "./CallSummaryCard";
import Turnstile from "./Turnstile";

const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? "";

// Public demo modal (landing page, /agents): listen to the agent's sample, or enter your name,
// business name and business type and talk to it live in the browser. No sign-in; the server
// applies the cost guards.

const STORAGE = "voizo.demo.visitor";

export interface VisitorDetails {
  firstName: string;
  company: string;
  businessType: string;
}

export function loadVisitor(): VisitorDetails {
  try {
    const raw = typeof window !== "undefined" ? window.localStorage.getItem(STORAGE) : null;
    const v = raw ? (JSON.parse(raw) as Partial<VisitorDetails>) : {};
    return { firstName: v.firstName ?? "", company: v.company ?? "", businessType: v.businessType ?? "" };
  } catch {
    return { firstName: "", company: "", businessType: "" };
  }
}

export function saveVisitor(v: VisitorDetails) {
  try {
    window.localStorage.setItem(STORAGE, JSON.stringify(v));
  } catch {
    /* private mode etc. */
  }
}

export const avatarStyle = (gender: "female" | "male") => ({ background: gender === "female" ? "linear-gradient(145deg,#e46fa5,#8b6cf0)" : "linear-gradient(145deg,#4d90f0,#22b8a7)" });

export default function AgentDemoModal({ agent, initial, onClose, onDetails }: {
  agent: GalleryAgent;
  initial: VisitorDetails;
  onClose: () => void;
  /** Lifts the typed details to the page so the next agent's modal is prefilled. */
  onDetails?: (v: VisitorDetails) => void;
}) {
  const [firstName, setFirstName] = useState(initial.firstName);
  const [company, setCompany] = useState(initial.company);
  const [businessType, setBusinessType] = useState(initial.businessType);
  const [preparing, setPreparing] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [captcha, setCaptcha] = useState<string | null>(null);
  const [captchaKey, setCaptchaKey] = useState(0);
  const [progress, setProgress] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const call = useVapiWebCall();
  const inCall = call.status === "mic" || call.status === "connecting" || call.status === "live";

  // Lock page scroll and close on Escape (not while a call is running).
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !inCall) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => { document.body.style.overflow = prev; window.removeEventListener("keydown", onKey); };
  }, [inCall, onClose]);
  useEffect(() => () => { audioRef.current?.pause(); call.stop(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function toggleSample() {
    if (!agent.sampleUrl) return;
    if (playing) { audioRef.current?.pause(); setPlaying(false); return; }
    if (!audioRef.current) {
      const el = new Audio(agent.sampleUrl);
      el.ontimeupdate = () => setProgress(el.duration ? el.currentTime / el.duration : 0);
      el.onended = () => { setPlaying(false); setProgress(0); };
      el.onerror = () => setPlaying(false);
      audioRef.current = el;
    }
    audioRef.current.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
  }

  async function startCall(e: FormEvent) {
    e.preventDefault();
    const v = { firstName: firstName.trim(), company: company.trim(), businessType: businessType.trim() };
    saveVisitor(v);
    onDetails?.(v);
    audioRef.current?.pause();
    setPlaying(false);
    setApiError(null);
    setPreparing(true);
    try {
      const r = await fetch("/api/public/demo-call", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: agent.key, ...v, turnstileToken: captcha ?? undefined }) });
      setCaptcha(null);
      setCaptchaKey((k) => k + 1);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "Could not prepare the call");
      await call.start(j.publicKey, j.assistantId, j.overrides);
    } catch (err) {
      setApiError(err instanceof Error ? err.message : "Could not prepare the call");
    } finally {
      setPreparing(false);
    }
  }

  const inputCls = "h-11 w-full rounded-xl border border-[var(--border-2)] bg-[var(--bg-elevated)] px-3.5 text-sm text-[var(--text-1)] outline-none placeholder:text-[var(--text-4)] focus:border-[var(--accent)] focus:ring-4 focus:ring-[var(--accent)]/15 disabled:opacity-60";
  const first = agent.name.split(" ")[0];

  return (
    <div className="fixed inset-0 z-[100] flex items-end justify-center bg-black/60 p-0 backdrop-blur-sm sm:items-center sm:p-4" onMouseDown={(e) => { if (e.target === e.currentTarget && !inCall) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-labelledby="demo-title" className="animate-slide-up flex max-h-[94vh] w-full max-w-lg flex-col overflow-hidden rounded-t-3xl border border-[var(--border)] bg-[var(--bg-card)] shadow-2xl sm:rounded-3xl">
        {/* header */}
        <div className="flex items-start gap-3 border-b border-[var(--border)] px-5 py-4">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-base font-bold text-white" style={avatarStyle(agent.gender)}>{agent.name[0]}</span>
          <div className="min-w-0 flex-1">
            <h2 id="demo-title" className="text-base font-semibold text-[var(--text-1)]">{agent.name} <span className="font-normal text-[var(--text-3)]">· {agent.role}</span></h2>
            <p className="text-xs text-[var(--text-3)]">{agent.industry} · {agent.tagline}</p>
          </div>
          <button type="button" onClick={onClose} disabled={inCall} aria-label="Close" className="rounded-lg p-1.5 text-[var(--text-3)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-1)] disabled:opacity-40"><X size={18} /></button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {inCall ? (
            <LiveCallPanel call={call} agentName={first} transcriptClass="min-h-[200px] max-h-[38vh]" />
          ) : (
            <>
              {/* Listen */}
              <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-elevated)] p-3.5">
                <div className="flex items-center gap-3">
                  <button type="button" onClick={toggleSample} disabled={!agent.sampleUrl} aria-label={playing ? "Pause sample" : "Play sample"}
                    className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-white transition hover:brightness-110 disabled:opacity-50" style={avatarStyle(agent.gender)}>
                    {playing && <span className="lp-ping absolute inset-0 rounded-full bg-white/30" />}
                    {playing ? <Pause size={17} /> : <Play size={17} className="ml-0.5" />}
                  </button>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-[var(--text-1)]">Listen to {first}</p>
                    <p className="text-[11px] text-[var(--text-3)]">{agent.sampleUrl ? "A short recorded sample of this agent's voice and style." : "Sample not available yet."}</p>
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--bg-app)]"><div className="h-full rounded-full transition-[width] duration-200" style={{ width: `${Math.round(progress * 100)}%`, background: "var(--accent)" }} /></div>
                  </div>
                </div>
                <blockquote className="mt-3 text-[12.5px] italic leading-relaxed text-[var(--text-3)]">“{agent.sampleText.length > 200 ? agent.sampleText.slice(0, 200).trimEnd() + "…" : agent.sampleText}”</blockquote>
              </div>

              <div className="my-4 flex items-center gap-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--text-4)]"><span className="h-px flex-1 bg-[var(--border)]" />or talk to {first} live<span className="h-px flex-1 bg-[var(--border)]" /></div>

              {/* Call form */}
              <form onSubmit={startCall} className="grid gap-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label htmlFor="demo-name" className="mb-1.5 block text-xs font-medium text-[var(--text-2)]">Your first name</label>
                    <input id="demo-name" required maxLength={40} value={firstName} onChange={(e) => setFirstName(e.target.value)} placeholder="e.g. Chris" className={inputCls} autoFocus={!firstName} />
                  </div>
                  <div>
                    <label htmlFor="demo-company" className="mb-1.5 block text-xs font-medium text-[var(--text-2)]">Business name</label>
                    <input id="demo-company" required maxLength={80} value={company} onChange={(e) => setCompany(e.target.value)} placeholder="e.g. Riverside Dental" className={inputCls} />
                  </div>
                </div>
                <div>
                  <label htmlFor="demo-type" className="mb-1.5 block text-xs font-medium text-[var(--text-2)]">Business type <span className="text-[var(--text-4)]">(what you do)</span></label>
                  <input id="demo-type" maxLength={200} value={businessType} onChange={(e) => setBusinessType(e.target.value)} placeholder="e.g. dental clinic, online casino, gym, car dealership" className={inputCls} />
                </div>
                {(apiError || call.error) && (
                  <div role="alert" className="flex items-start gap-2.5 rounded-xl border border-red-500/25 bg-red-500/10 px-3.5 py-3 text-sm text-red-300"><AlertCircle size={16} className="mt-0.5 shrink-0" /><span>{apiError ?? call.error}</span></div>
                )}
                {call.status === "ended" && !call.error && (
                  <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/10 px-3.5 py-3 text-sm text-emerald-200">
                    Call ended after {formatSeconds(call.seconds)}. That was {agent.demo?.calls === "to" ? `${agent.name} from ${agent.demo.seller} calling ${company || "your business"}` : `${agent.name} calling for ${company || "your business"}`}, with zero setup.
                    <a href="/signup" className="mt-2 inline-flex items-center gap-1 font-semibold text-emerald-100 hover:underline">Create a free account to make it yours <ArrowRight size={13} /></a>
                  </div>
                )}
                {call.status === "ended" && !call.error && <CallSummaryCard agentKey={agent.key} firstName={firstName} company={company} transcript={call.transcript} seconds={call.seconds} />}
                {TURNSTILE_SITE_KEY && <Turnstile key={captchaKey} siteKey={TURNSTILE_SITE_KEY} action="demo_call" onToken={setCaptcha} />}
                <button type="submit" disabled={preparing || !firstName.trim() || !company.trim() || (Boolean(TURNSTILE_SITE_KEY) && !captcha)} className="mt-1 inline-flex h-12 items-center justify-center gap-2 rounded-xl text-sm font-semibold text-[var(--accent-fg)] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60" style={{ background: "var(--accent)", boxShadow: "0 8px 24px color-mix(in srgb, var(--accent) 20%, transparent)" }}>
                  {preparing ? <Loader2 size={16} className="animate-spin" /> : <Phone size={16} />} {call.status === "ended" ? `Call ${first} again` : `Start the call with ${first}`}
                </button>
                <p className="flex items-center gap-1.5 text-[11px] text-[var(--text-4)]"><Headphones size={12} /> {first} calls you in the browser. Use headphones if you can; your browser will ask for the microphone first. Demo calls last up to 4 minutes.</p>
                {call.status === "ended" && (
                  <button type="button" onClick={call.reset} className="inline-flex items-center gap-1.5 self-start text-xs text-[var(--text-3)] hover:text-[var(--text-1)]"><RotateCcw size={12} /> Clear</button>
                )}
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
