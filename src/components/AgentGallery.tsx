"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Loader2, Lock, Pause, Phone, Play, Sparkles, Star } from "lucide-react";

// Cards for the pre-built agents, with a play button for each sample clip. Used by the public
// /agents page and the landing page (read-only) and by the in-app templates page (install).

export interface GalleryAgent {
  key: string; name: string; role: string; industry: string; tagline: string; description: string;
  tier: "free" | "pro"; priceUsd: number; priceEur: number; gender: "female" | "male"; tags: string[];
  sampleUrl: string | null; sampleText: string;
  unlocked?: boolean; installedScriptId?: string | null;
}

export default function AgentGallery({ agents, currency = "USD", onInstall, installing, compact, onTry, highlightKeys = [], recommendGender }: {
  agents: GalleryAgent[];
  currency?: "USD" | "EUR";
  /** In-app: install handler; absent on marketing pages. */
  onInstall?: (agent: GalleryAgent) => void;
  installing?: string | null;
  compact?: boolean;
  /** Marketing pages: open the demo modal (listen, or talk live) for this agent. */
  onTry?: (agent: GalleryAgent) => void;
  /** Agents the matcher suggested; drawn with a "Suggested for you" badge. */
  highlightKeys?: string[];
  /** Voices to mark as "Recommended" (the stronger of the two sample voices). */
  recommendGender?: "male" | "female";
}) {
  const [playing, setPlaying] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => () => { audioRef.current?.pause(); }, []);

  function toggle(a: GalleryAgent) {
    if (!a.sampleUrl) return;
    if (playing === a.key) { audioRef.current?.pause(); setPlaying(null); return; }
    audioRef.current?.pause();
    const el = new Audio(a.sampleUrl);
    audioRef.current = el;
    el.onended = () => setPlaying(null);
    el.onerror = () => setPlaying(null);
    el.play().then(() => setPlaying(a.key)).catch(() => setPlaying(null));
  }

  const price = (a: GalleryAgent) => (currency === "EUR" ? `€${a.priceEur}` : `$${a.priceUsd}`);

  return (
    <div className={`grid gap-4 ${compact ? "sm:grid-cols-2 lg:grid-cols-4" : "sm:grid-cols-2 lg:grid-cols-3"}`}>
      {agents.map((a) => {
        const isPlaying = playing === a.key;
        const initials = a.name[0];
        const suggested = highlightKeys.includes(a.key);
        const Body = onTry ? "button" : "div";
        return (
          <article key={a.key} className={`glow-card relative flex flex-col rounded-2xl border bg-[var(--bg-card)] p-5 ${suggested ? "border-[var(--accent)]/60" : "border-[var(--border)]"}`} style={{ "--glow-color": a.tier === "free" ? "#2fb673" : "var(--accent)" } as React.CSSProperties}>
            {suggested && <span className="absolute -top-2.5 right-4 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[var(--accent-fg)]" style={{ background: "var(--accent)" }}>Suggested for you</span>}
            <div className="flex items-start gap-3">
              <button type="button" onClick={() => toggle(a)} disabled={!a.sampleUrl} aria-label={isPlaying ? `Pause ${a.name}'s sample` : `Play ${a.name}'s sample`}
                className="relative flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-white transition hover:brightness-110 disabled:opacity-50"
                style={{ background: a.gender === "female" ? "linear-gradient(145deg,#e46fa5,#8b6cf0)" : "linear-gradient(145deg,#4d90f0,#22b8a7)" }}>
                {isPlaying && <span className="lp-ping absolute inset-0 rounded-full bg-white/30" />}
                {isPlaying ? <Pause size={18} /> : a.sampleUrl ? <Play size={18} className="ml-0.5" /> : <span className="text-sm font-bold">{initials}</span>}
              </button>
              <Body type={onTry ? "button" : undefined} onClick={onTry ? () => onTry(a) : undefined} className={`min-w-0 flex-1 text-left ${onTry ? "cursor-pointer rounded-lg -m-1 p-1 hover:bg-[var(--bg-hover)]" : ""}`} title={onTry ? `Listen to ${a.name} or talk live` : undefined}>
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-base font-semibold text-[var(--text-1)]">{a.name}</h3>
                  {recommendGender && a.gender === recommendGender && <span className="inline-flex items-center gap-1 rounded-full border border-amber-400/40 bg-amber-400/10 px-2 py-0.5 text-[11px] font-medium text-amber-300" title="One of our strongest voices"><Star size={10} /> Recommended</span>}
                  {a.tier === "free" ? (
                    <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-300">Free</span>
                  ) : a.unlocked ? (
                    <span className="rounded-full border border-[var(--accent)]/30 bg-[var(--accent)]/10 px-2 py-0.5 text-[11px] font-medium text-[var(--accent)]">Unlocked</span>
                  ) : (
                    <span className="inline-flex items-center gap-1 rounded-full border border-[var(--border)] bg-[var(--bg-elevated)] px-2 py-0.5 text-[11px] font-medium text-[var(--text-2)]"><Lock size={10} /> {price(a)}</span>
                  )}
                </div>
                <p className="text-sm font-medium text-[var(--text-2)]">{a.role}</p>
                <p className="text-xs text-[var(--text-3)]">{a.industry}</p>
              </Body>
            </div>
            <p className="mt-4 text-sm leading-relaxed text-[var(--text-2)]">{compact ? a.tagline : a.description}</p>
            {!compact && (
              <blockquote className="mt-3 rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] px-3.5 py-3 text-[13px] italic leading-relaxed text-[var(--text-3)]">
                “{a.sampleText.length > 170 ? a.sampleText.slice(0, 170).trimEnd() + "…" : a.sampleText}”
              </blockquote>
            )}
            <div className="mt-4 flex flex-wrap items-center gap-1.5">
              {a.tags.slice(0, 3).map((t) => <span key={t} className="rounded-md bg-[var(--bg-elevated)] px-2 py-0.5 text-[11px] text-[var(--text-3)]">{t}</span>)}
            </div>
            {onTry && !onInstall && (
              <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-[var(--border)] pt-4">
                <span className="mr-auto text-[11px] text-[var(--text-4)]">Listen · Talk live</span>
                <button type="button" onClick={() => toggle(a)} disabled={!a.sampleUrl} aria-label={isPlaying ? `Pause ${a.name}'s sample` : `Listen to ${a.name}`} title={isPlaying ? "Pause" : "Listen to a sample"} className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-[var(--border-2)] bg-[var(--bg-elevated)] text-[var(--text-1)] transition hover:bg-[var(--bg-hover)] disabled:opacity-50">{isPlaying ? <Pause size={16} /> : <Play size={16} className="ml-0.5" />}</button>
                <button type="button" onClick={() => onTry(a)} aria-label={`Talk to ${a.name}`} title={`Talk to ${a.name} live in your browser`} className="inline-flex h-10 w-10 items-center justify-center rounded-xl text-[var(--accent-fg)] transition hover:brightness-110" style={{ background: "var(--accent)" }}><Phone size={16} /></button>
              </div>
            )}
            {onInstall && (
              <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-[var(--border)] pt-4">
                <a href={`/agents/try?agent=${a.key}`} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-[var(--accent)]/40 bg-[var(--accent)]/10 px-3 text-xs font-semibold text-[var(--accent)] hover:bg-[var(--accent)]/20" title="Talk to this agent in your browser"><Phone size={13} /> Try live call</a>
                {a.installedScriptId ? (
                  <a href={`/script-builder?id=${a.installedScriptId}`} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 text-xs font-medium text-emerald-300 hover:bg-emerald-500/20"><Check size={13} /> Open in Script Builder</a>
                ) : a.tier === "free" || a.unlocked ? (
                  <button type="button" onClick={() => onInstall(a)} disabled={installing !== null && installing !== undefined} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-[var(--accent)] px-3 text-xs font-semibold text-[var(--accent-fg)] hover:brightness-110 disabled:opacity-60">
                    {installing === a.key ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />} Add to my agents
                  </button>
                ) : (
                  <button type="button" onClick={() => onInstall(a)} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] px-3 text-xs font-medium text-[var(--text-2)] hover:text-[var(--text-1)]"><Lock size={13} /> Unlock for {price(a)}</button>
                )}
                {a.installedScriptId && (a.tier === "free" || a.unlocked) && (
                  <button type="button" onClick={() => onInstall(a)} disabled={installing !== null && installing !== undefined} className="text-xs text-[var(--text-3)] hover:text-[var(--text-1)]">Add another copy</button>
                )}
              </div>
            )}
          </article>
        );
      })}
    </div>
  );
}
