import Link from "next/link";
import type { Metadata } from "next";
import { ArrowRight } from "lucide-react";
import { AGENT_CATALOG, publicAgent } from "@/lib/agents/catalog";
import { sampleUrl } from "@/lib/agents/entitlements";
import AgentGallery from "@/components/AgentGallery";

export const metadata: Metadata = {
  title: "Pre-built voice agents — VOIZO",
  description: "Twenty ready-to-run AI voice agents for appointment reminders, lead follow-up, payments, renewals and more. Listen to each one.",
};

const PRIMARY = "#4d90f0";

// Public gallery: listen to every agent; three are free to use, the rest unlock per organization.
export default function AgentsPage() {
  const agents = AGENT_CATALOG.map((a) => ({ ...publicAgent(a), sampleUrl: sampleUrl(a.key) }));
  const free = agents.filter((a) => a.tier === "free").length;
  return (
    <div className="relative min-h-screen text-[var(--text-1)]">
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-[520px] -z-[1]" style={{ background: `radial-gradient(50% 60% at 50% 0%, ${PRIMARY}2e, transparent 70%)` }} />
      <header className="sticky top-0 z-30 border-b border-[var(--border)] bg-[color-mix(in_srgb,var(--bg-app)_80%,transparent)] backdrop-blur-md">
        <nav className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
          <Link href="/" className="flex items-center gap-2.5" aria-label="VOIZO home">
            <span className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: "linear-gradient(145deg,#4d90f0,#3a6fd0)", boxShadow: "0 2px 10px rgba(77,144,240,.35)" }}><span className="text-white text-sm font-bold">V</span></span>
            <span className="font-bold tracking-tight">VOIZO</span>
          </Link>
          <div className="hidden md:flex items-center gap-8 text-sm text-[var(--text-2)]">
            <Link href="/agents" className="text-[var(--text-1)]">Agents</Link>
            <Link href="/pricing" className="hover:text-[var(--text-1)] transition-colors">Pricing</Link>
          </div>
          <Link href="/login" className="inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-semibold text-white transition hover:brightness-110" style={{ background: PRIMARY }}>Sign in <ArrowRight size={15} /></Link>
        </nav>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
        <p className="text-xs font-semibold uppercase tracking-[0.18em]" style={{ color: PRIMARY }}>Pre-built agents</p>
        <h1 className="mt-3 text-3xl font-bold tracking-tight sm:text-5xl">Twenty agents, ready to call today</h1>
        <p className="mt-4 max-w-2xl text-[var(--text-2)]">
          Each one is a complete, editable script: the opening, the reason for the call, the replies customers actually give, the follow-up text and the goodbye. Press play to hear how they sound. {free} are free with every account; the rest unlock per organization or come with the Pro plan.
        </p>
        <div className="mt-10">
          <AgentGallery agents={agents} />
        </div>
        <div className="mt-14 rounded-3xl px-8 py-12 text-center" style={{ background: `linear-gradient(135deg, ${PRIMARY}, #3a6fd0 55%, #6b5cd6)` }}>
          <h2 className="text-2xl font-bold text-white sm:text-3xl">Make them yours</h2>
          <p className="mx-auto mt-3 max-w-xl text-white/80">Add an agent to your workspace, swap in your company name and offer, pick a voice, and test it with a real call before any customer hears it.</p>
          <Link href="/signup" className="mt-6 inline-flex items-center gap-2 rounded-xl bg-white px-6 py-3 text-sm font-semibold text-[#1f3f7a] hover:bg-white/90">Create a free account <ArrowRight size={16} /></Link>
        </div>
      </main>
    </div>
  );
}
