"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { AlertCircle, Loader2, Pause, Phone, Play, Sparkles, Wand2 } from "lucide-react";
import AgentGallery, { type GalleryAgent } from "./AgentGallery";
import AgentDemoModal, { avatarStyle, loadVisitor, saveVisitor, type VisitorDetails } from "./AgentDemoModal";

// Marketing pages: the agent gallery plus the "which agent fits my business?" matcher. Selecting
// an agent opens the demo modal (listen, or talk to it live). Visitor details typed anywhere are
// shared with every modal on the page.

const PRIMARY = "#4d90f0";

interface Match { key: string; name: string; role: string; reason: string }

export default function PublicAgentsShowcase({ agents, featured, compact }: {
  /** The whole public catalog (the matcher may suggest any of them). */
  agents: GalleryAgent[];
  /** Show only the first N in the grid (landing page); all when absent. */
  featured?: number;
  compact?: boolean;
}) {
  const [open, setOpen] = useState<GalleryAgent | null>(null);
  const [visitor, setVisitor] = useState<VisitorDetails>({ firstName: "", company: "", businessType: "" });
  const [company, setCompany] = useState("");
  const [businessType, setBusinessType] = useState("");
  const [matching, setMatching] = useState(false);
  const [matchError, setMatchError] = useState<string | null>(null);
  const [matches, setMatches] = useState<Match[] | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const hydrated = useRef(false);

  // Prefill from a previous visit (after hydration, so server and client markup agree).
  useEffect(() => {
    if (hydrated.current) return;
    hydrated.current = true;
    const v = loadVisitor();
    if (v.firstName || v.company || v.businessType) {
      setVisitor(v); setCompany(v.company); setBusinessType(v.businessType);
    }
  }, []);
  useEffect(() => () => { audioRef.current?.pause(); }, []);

  const byKey = useCallback((key: string) => agents.find((a) => a.key === key) ?? null, [agents]);

  function openAgent(a: GalleryAgent) {
    audioRef.current?.pause();
    setPlaying(null);
    setOpen(a);
  }

  function togglePlay(a: GalleryAgent) {
    if (!a.sampleUrl) return;
    if (playing === a.key) { audioRef.current?.pause(); setPlaying(null); return; }
    audioRef.current?.pause();
    const el = new Audio(a.sampleUrl);
    audioRef.current = el;
    el.onended = () => setPlaying(null);
    el.onerror = () => setPlaying(null);
    el.play().then(() => setPlaying(a.key)).catch(() => setPlaying(null));
  }

  async function findAgents(e: FormEvent) {
    e.preventDefault();
    const v = { ...visitor, company: company.trim(), businessType: businessType.trim() };
    setVisitor(v);
    saveVisitor(v);
    setMatchError(null);
    setMatching(true);
    try {
      const r = await fetch("/api/public/agent-match", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ businessType: v.businessType, businessName: v.company }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "Could not find a match");
      setMatches(j.matches as Match[]);
    } catch (err) {
      setMatchError(err instanceof Error ? err.message : "Could not find a match");
    } finally {
      setMatching(false);
    }
  }

  const inputCls = "h-11 w-full rounded-xl border border-[var(--border-2)] bg-[var(--bg-elevated)] px-3.5 text-sm text-[var(--text-1)] outline-none placeholder:text-[var(--text-4)] focus:border-[#4d90f0] focus:ring-4 focus:ring-[#4d90f0]/15";
  const suggestedKeys = matches?.map((m) => m.key) ?? [];

  return (
    <div>
      {/* ── Matcher ── */}
      <section className="rounded-3xl border border-[var(--border)] bg-[var(--bg-card)] p-5 sm:p-6" style={{ boxShadow: `0 0 0 1px ${PRIMARY}22 inset, 0 20px 60px -30px ${PRIMARY}66` }}>
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-white" style={{ background: `linear-gradient(145deg,${PRIMARY},#6b5cd6)` }}><Wand2 size={18} /></span>
          <div>
            <h3 className="text-lg font-semibold text-[var(--text-1)]">Which agent fits your business?</h3>
            <p className="text-sm text-[var(--text-2)]">Tell us what you do and we&apos;ll pick the three agents that would help most. Then listen, or talk to one live.</p>
          </div>
        </div>
        <form onSubmit={findAgents} className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)_auto]">
          <input aria-label="Business name" maxLength={80} value={company} onChange={(e) => setCompany(e.target.value)} placeholder="Business name (optional)" className={inputCls} />
          <input aria-label="What does your business do?" required minLength={3} maxLength={200} value={businessType} onChange={(e) => setBusinessType(e.target.value)} placeholder="What do you do? e.g. dental clinic with 3 locations" className={inputCls} />
          <button type="submit" disabled={matching || businessType.trim().length < 3} className="inline-flex h-11 items-center justify-center gap-2 rounded-xl px-5 text-sm font-semibold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60" style={{ background: PRIMARY }}>
            {matching ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />} Find my agents
          </button>
        </form>
        {matchError && <p role="alert" className="mt-3 flex items-center gap-2 text-sm text-red-300"><AlertCircle size={14} /> {matchError}</p>}
        {matches && (
          <ol className="mt-5 grid gap-3 md:grid-cols-3">
            {matches.map((m, i) => {
              const a = byKey(m.key);
              if (!a) return null;
              const isPlaying = playing === a.key;
              return (
                <li key={m.key} className="flex flex-col rounded-2xl border border-primary/30 bg-primary/5 p-4">
                  <div className="flex items-center gap-3">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white" style={avatarStyle(a.gender)}>{a.name[0]}</span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-[var(--text-1)]">{i === 0 && <span className="mr-1.5 rounded-md bg-primary/20 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-primary">Best fit</span>}{a.name}</p>
                      <p className="truncate text-xs text-[var(--text-3)]">{a.role}</p>
                    </div>
                  </div>
                  <p className="mt-3 flex-1 text-[13px] leading-relaxed text-[var(--text-2)]">{m.reason}</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button type="button" onClick={() => togglePlay(a)} disabled={!a.sampleUrl} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-[var(--border-2)] bg-[var(--bg-card)] px-3 text-xs font-medium text-[var(--text-1)] hover:bg-[var(--bg-hover)] disabled:opacity-50">{isPlaying ? <Pause size={13} /> : <Play size={13} />} {isPlaying ? "Pause" : "Listen"}</button>
                    <button type="button" onClick={() => openAgent(a)} className="inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold text-white hover:brightness-110" style={{ background: PRIMARY }}><Phone size={13} /> Talk to {a.name.split(" ")[0]}</button>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </section>

      {/* ── Gallery ── */}
      <div className="mt-8">
        <AgentGallery compact={compact} agents={featured ? agents.slice(0, featured) : agents} onTry={openAgent} highlightKeys={suggestedKeys} />
      </div>

      {open && (
        <AgentDemoModal
          key={open.key}
          agent={open}
          initial={{ ...visitor, company: visitor.company || company, businessType: visitor.businessType || businessType }}
          onClose={() => setOpen(null)}
          onDetails={(v) => { setVisitor(v); setCompany(v.company); setBusinessType(v.businessType); }}
        />
      )}
    </div>
  );
}
