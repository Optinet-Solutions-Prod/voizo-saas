import Link from "next/link";
import type { Metadata } from "next";
import {
  ArrowRight, Ban, BarChart3, Bot, CalendarClock, Check, ChevronRight, Clock, FileCheck, Mail,
  MessageCircle, MessageSquareText, PhoneCall, Server, Smartphone, Sparkles, UserX, Users,
  Workflow, Zap,
} from "lucide-react";
import MarketingLogo from "@/components/MarketingLogo";
import PublicAgentsShowcase from "@/components/PublicAgentsShowcase";
import TryItNowButton from "@/components/TryItNow";
import { AGENT_CATALOG, publicAgent, showcaseOrder } from "@/lib/agents/catalog";
import { sampleUrl } from "@/lib/agents/entitlements";
import { MARKETING_SHELL } from "@/lib/marketingFonts";

export const metadata: Metadata = {
  title: "VOIZO — Calls on the go. Agents on the go.",
  description:
    "AI voice agents ready as they are, anytime, anywhere: numbers, SMS, email and SIP trunk included, or bring your own. Calls to mobiles, landlines and WhatsApp.",
};

// Public landing page (the middleware leaves "/" open). Server-rendered, no data fetches.
// Restyled after deepgram.com (Chris, 2026-10-01): black ground, hairline borders, one green
// accent, mono eyebrow labels, and the reference's section order — centered hero, capability
// strip, product shot, featured product (the agents), platform grid, pipeline diagram, three
// journeys, a "built for scale" panel, final CTA, multi-column footer. Everything visual comes
// from the .dg-site theme in globals.css; the console keeps its own look.

const FEATURES = [
  { icon: Bot, title: "AI voice agents", body: "Give each agent a voice, a persona and a prompt. Every campaign runs its own frozen copy, so editing an agent never disturbs a live campaign." },
  { icon: Workflow, title: "Script builder & lab", body: "Map the conversation as a flow of stages and answers, then test it with a real call in the lab before a single customer hears it." },
  { icon: CalendarClock, title: "Campaigns that run themselves", body: "One-off, recurring or real-time campaigns with calling windows, per-country caller IDs and concurrency limits you control." },
  { icon: MessageSquareText, title: "SMS follow-up", body: "Send the offer by text after the call, with consent rules per campaign and de-duplication so nobody gets the same message twice." },
  { icon: Sparkles, title: "AI call reviews", body: "An LLM judge scores conversations against your rubric, and a review queue lets your team label the calls that matter." },
  { icon: BarChart3, title: "Analytics that add up", body: "Reach, pickups, conversations, opt-ins and cost per campaign, with exports for your CRM and a daily snapshot of the numbers." },
  { icon: Zap, title: "On the go, ready as it is", body: "Phone numbers, SMS, email and a SIP trunk come with your account. Pick an agent, add your brand, press start. Anytime, anywhere." },
  { icon: MessageCircle, title: "WhatsApp calling", body: "Reach customers on WhatsApp through Meta's Business Calling API, alongside mobile and landline numbers, from the same campaign." },
];

const CAPABILITIES = [
  { icon: Smartphone, label: "Mobile & landline" },
  { icon: MessageCircle, label: "WhatsApp calling" },
  { icon: MessageSquareText, label: "SMS follow-up" },
  { icon: Mail, label: "Email follow-up" },
  { icon: Server, label: "SIP trunk included" },
  { icon: PhoneCall, label: "Numbers per country" },
];

const PIPELINE = [
  { icon: Users, label: "Audience", sub: "Upload a list or sync a segment" },
  { icon: Bot, label: "Agent", sub: "Voice, persona and script" },
  { icon: PhoneCall, label: "Call", sub: "Mobile, landline or WhatsApp" },
  { icon: MessageSquareText, label: "Follow-up", sub: "SMS and email, consent-aware" },
  { icon: Sparkles, label: "AI review", sub: "Scored against your rubric" },
  { icon: BarChart3, label: "Analytics", sub: "Reach, outcomes and cost" },
];

const STEPS = [
  { n: "01", title: "Build your agent", body: "Pick a voice, write the persona and script, and test it live in the lab." },
  { n: "02", title: "Launch a campaign", body: "Upload an audience, set calling windows and caller IDs, and press start." },
  { n: "03", title: "Review and improve", body: "Read transcripts, let the AI judge score them, and tune the script from what works." },
];

const JOURNEYS = [
  {
    icon: Zap,
    title: "Start on the go",
    body: "Phone numbers, SMS, email and a SIP trunk come with your account. Pick an agent, add your brand, press start.",
    points: ["VOIZO numbers with per-country caller IDs", "SMS and email follow-ups sent for you", "WhatsApp calling once your number is enabled"],
    cta: { label: "Take a live call", href: "#agents" },
  },
  {
    icon: Workflow,
    title: "Build your own agent",
    body: "Write the persona, map the conversation as stages and answers, and test it with a real call in the lab.",
    points: ["Script builder with reply detectors", "Lab calls before any customer hears it", "An AI judge scores every conversation"],
    cta: { label: "See how it works", href: "#how" },
  },
  {
    icon: Server,
    title: "Bring your own carrier",
    body: "Keep your numbers, your SIP trunk and your senders. Switch with one setting, no rebuild.",
    points: ["Your SIP trunk, Squaretalk, Twilio or FreeSWITCH", "Your SMS and email providers, encrypted at rest", "Mix and match: VOIZO fills in whatever you don't connect"],
    cta: { label: "Open the console", href: "/login" },
  },
];

const RAILS = [
  { icon: Ban, title: "Do-not-call & suppression", body: "Both lists are checked before every single dial." },
  { icon: Clock, title: "Calling windows", body: "Calls only go out inside each campaign's hours." },
  { icon: FileCheck, title: "Consent rules", body: "SMS follows the consent mode you choose per campaign." },
  { icon: UserX, title: "Opt-outs honoured", body: "A request to stop is honoured automatically." },
];

const FOOTER = [
  { title: "Product", links: [{ label: "Pre-built agents", href: "/agents" }, { label: "Platform", href: "#features" }, { label: "How it works", href: "#how" }, { label: "Pricing", href: "/pricing" }] },
  { title: "Try it", links: [{ label: "Take a live call", href: "#agents" }, { label: "Which agent fits?", href: "#agents" }, { label: "All 20 agents", href: "/agents" }] },
  { title: "Account", links: [{ label: "Log in", href: "/login" }, { label: "Create an account", href: "/signup" }] },
];

const TRANSCRIPT = [
  { who: "agent", text: "Hi, it's Ava calling from Riverside Dental." },
  { who: "person", text: "Hi, yes?" },
  { who: "agent", text: "Just to check, am I speaking with Chris?" },
  { who: "person", text: "Speaking." },
  { who: "agent", text: "Great. I'm calling to confirm your appointment tomorrow at ten thirty. Does that still work for you?" },
  { who: "person", text: "Yes, that's fine." },
];

function NavLink({ href, className, children }: { href: string; className?: string; children: React.ReactNode }) {
  return href.startsWith("#") ? <a href={href} className={className}>{children}</a> : <Link href={href} className={className}>{children}</Link>;
}

function CallCard() {
  return (
    <div className="relative">
      <div aria-hidden className="pointer-events-none absolute -inset-10 rounded-[2rem] opacity-25 blur-3xl" style={{ background: "radial-gradient(60% 60% at 50% 40%, #00f099, transparent 70%)" }} />
      <div className="relative overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--bg-card)] shadow-2xl">
        <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-3.5">
          <div className="flex items-center gap-3">
            <span className="relative flex h-8 w-8 items-center justify-center rounded-full bg-[var(--accent)]/15">
              <span className="lp-ping absolute inset-0 rounded-full bg-[var(--accent)]/40" />
              <PhoneCall size={14} className="text-[var(--accent)]" />
            </span>
            <p className="text-sm font-semibold">Live call</p>
          </div>
          <span className="dg-mono text-xs text-[var(--text-3)]">00:42</span>
        </div>
        <div className="flex h-14 items-center justify-center gap-[3px] border-b border-[var(--border)] px-5" aria-hidden>
          {Array.from({ length: 48 }).map((_, i) => (
            <span
              key={i}
              className="lp-wave-bar w-[3px] rounded-full"
              style={{ height: `${20 + ((i * 37) % 60)}%`, background: i % 5 === 0 ? "var(--accent)" : "var(--border-2)", animationDelay: `${(i % 9) * 0.11}s` }}
            />
          ))}
        </div>
        <div className="space-y-2.5 px-5 py-5">
          {TRANSCRIPT.map((line, i) => (
            <div key={i} className={`flex ${line.who === "agent" ? "justify-start" : "justify-end"}`}>
              <p
                className={`max-w-[78%] rounded-lg px-3.5 py-2 text-[13px] leading-snug ${
                  line.who === "agent" ? "bg-[var(--bg-elevated)] text-[var(--text-1)]" : "bg-[var(--accent)] text-[var(--accent-fg)]"
                }`}
              >
                {line.text}
              </p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function LandingPage() {
  const year = new Date().getFullYear();
  return (
    <div className={`${MARKETING_SHELL} relative min-h-screen overflow-x-hidden bg-[var(--bg-app)] text-[var(--text-1)]`}>
      {/* ── Nav ── */}
      <header className="sticky top-0 z-30 border-b border-[var(--border)] bg-black/80 backdrop-blur-md">
        <nav className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6">
          <MarketingLogo />
          <div className="hidden items-center gap-7 text-sm text-[var(--text-2)] md:flex">
            <a href="#agents" className="transition-colors hover:text-[var(--text-1)]">Agents</a>
            <a href="#features" className="transition-colors hover:text-[var(--text-1)]">Platform</a>
            <a href="#how" className="transition-colors hover:text-[var(--text-1)]">How it works</a>
            <Link href="/pricing" className="transition-colors hover:text-[var(--text-1)]">Pricing</Link>
          </div>
          <div className="flex items-center gap-2">
            <Link href="/login" className="dg-btn dg-btn-sm text-[var(--text-2)] hover:text-[var(--text-1)]">Log in</Link>
            <Link href="/signup" className="dg-btn dg-btn-sm dg-btn-primary">Sign up free</Link>
          </div>
        </nav>
      </header>
      {/* announcement bar, like the reference's promo strip under the nav */}
      <div className="border-b border-[var(--border)] bg-[var(--bg-panel)]">
        <a href="#agents" className="mx-auto flex max-w-7xl items-center justify-center gap-2.5 px-4 py-2 text-xs text-[var(--text-2)] transition-colors hover:text-[var(--text-1)]">
          <span className="dg-eyebrow">New</span>
          <span>Agents now confirm who they&apos;re speaking with, by name. Take a live call to hear it</span>
          <ArrowRight size={13} />
        </a>
      </div>

      <main>
        {/* ── Hero ── */}
        <section className="mx-auto max-w-4xl px-4 pb-12 pt-20 text-center sm:px-6 md:pt-28">
          <h1 className="dg-display text-4xl leading-[1.05] sm:text-6xl lg:text-[4.5rem]">
            AI agents ready to call
            <br />
            <span className="dg-gradient-text">for your business.</span>
          </h1>
          <div className="mx-auto mt-6 max-w-2xl space-y-3 text-base leading-relaxed text-[var(--text-3)] sm:text-lg">
            <p>
              Choose an agent, add your brand, and start calling with VOIZO&rsquo;s numbers, carrier, SMS, and email
              infrastructure already in place.
            </p>
            <p>Prefer your own setup? Connect your own carrier, numbers, and senders.</p>
            <p>Reach customers through mobile, landline, and WhatsApp.</p>
          </div>
          <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
            <TryItNowButton className="dg-btn dg-btn-primary" />
            <Link href="/login" className="dg-btn dg-btn-secondary">
              Open the console <ArrowRight size={15} />
            </Link>
          </div>
          <p className="mt-4 text-xs text-[var(--text-4)]">Take a live call from an AI agent in your browser. No account, no setup.</p>
        </section>

        {/* ── Capability strip (the reference's trust bar) ── */}
        <section aria-label="What is included" className="border-y border-[var(--border)]">
          <ul className="mx-auto flex max-w-7xl flex-wrap items-center justify-center gap-x-10 gap-y-3 px-4 py-5 sm:px-6">
            {CAPABILITIES.map(({ icon: Icon, label }) => (
              <li key={label} className="dg-mono flex items-center gap-2 text-[11px] uppercase tracking-[0.08em] text-[var(--text-3)]">
                <Icon size={14} className="text-[var(--accent)]" /> {label}
              </li>
            ))}
          </ul>
        </section>

        {/* ── Product shot ── */}
        <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6">
          <div className="mx-auto max-w-3xl">
            <CallCard />
          </div>
        </section>

        {/* ── Featured: the pre-built agents (listen, then talk) ── */}
        <section id="agents" className="scroll-mt-16 border-t border-[var(--border)] bg-[var(--bg-panel)]">
          <div className="mx-auto max-w-7xl px-4 py-20 sm:px-6">
            <div className="flex flex-wrap items-end justify-between gap-6">
              <div className="max-w-2xl">
                <p className="dg-eyebrow">Pre-built agents</p>
                <h2 className="dg-display mt-3 text-3xl sm:text-5xl">Hear them, then talk to them</h2>
                <p className="mt-4 text-[var(--text-3)]">
                  Twenty agents for the calls businesses make most: reminders, lead follow-up, payments, renewals,
                  surveys. Listen to any of them, or enter your name and business and take a live call from one, right
                  here, no account needed. Three are free with every account.
                </p>
              </div>
              <Link href="/agents" className="dg-btn dg-btn-secondary">
                See all 20 agents <ArrowRight size={15} />
              </Link>
            </div>
            <div className="mt-10">
              <PublicAgentsShowcase compact featured={8} agents={showcaseOrder(AGENT_CATALOG).map((a) => ({ ...publicAgent(a), sampleUrl: sampleUrl(a.key) }))} />
            </div>
          </div>
        </section>

        {/* ── Platform grid ── */}
        <section id="features" className="mx-auto max-w-7xl scroll-mt-16 px-4 py-20 sm:px-6">
          <div className="max-w-2xl">
            <p className="dg-eyebrow">The platform</p>
            <h2 className="dg-display mt-3 text-3xl sm:text-5xl">One console to run your whole calling operation</h2>
            <p className="mt-4 text-[var(--text-3)]">From the first draft of a script to the report on how it performed.</p>
          </div>
          <div className="mt-12 grid gap-px overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--border)] sm:grid-cols-2 lg:grid-cols-4">
            {FEATURES.map(({ icon: Icon, title, body }) => (
              <div key={title} className="bg-[var(--bg-card)] p-6 transition-colors hover:bg-[var(--bg-elevated)]">
                <Icon size={20} className="text-[var(--accent)]" />
                <h3 className="mt-5 font-semibold">{title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-[var(--text-3)]">{body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ── Pipeline + three steps ── */}
        <section id="how" className="scroll-mt-16 border-y border-[var(--border)] bg-[var(--bg-panel)]">
          <div className="mx-auto max-w-7xl px-4 py-20 sm:px-6">
            <div className="max-w-2xl">
              <p className="dg-eyebrow">How it works</p>
              <h2 className="dg-display mt-3 text-3xl sm:text-5xl">One flow from audience to answered call</h2>
              <p className="mt-4 text-[var(--text-3)]">Every campaign runs the same pipeline, whether it calls fifty people or fifty thousand.</p>
            </div>
            <ol className="mt-12 grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
              {PIPELINE.map(({ icon: Icon, label, sub }, i) => (
                <li key={label} className="dg-card relative p-5">
                  <span className="dg-mono text-[11px] text-[var(--text-4)]">0{i + 1}</span>
                  <Icon size={20} className="mt-3 text-[var(--accent)]" />
                  <p className="mt-3 font-semibold">{label}</p>
                  <p className="mt-1 text-xs leading-relaxed text-[var(--text-3)]">{sub}</p>
                  {i < PIPELINE.length - 1 && (
                    <ChevronRight size={16} className="absolute -right-3.5 top-1/2 hidden -translate-y-1/2 text-[var(--text-4)] lg:block" aria-hidden />
                  )}
                </li>
              ))}
            </ol>
            <ol className="mt-12 grid gap-6 md:grid-cols-3">
              {STEPS.map((s) => (
                <li key={s.n} className="border-t border-[var(--border)] pt-5">
                  <span className="dg-mono text-sm text-[var(--accent)]">{s.n}</span>
                  <h3 className="mt-3 text-lg font-semibold">{s.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-[var(--text-3)]">{s.body}</p>
                </li>
              ))}
            </ol>
            <div className="mt-12">
              <TryItNowButton className="dg-btn dg-btn-primary" />
            </div>
          </div>
        </section>

        {/* ── Three ways in ── */}
        <section id="run" className="mx-auto max-w-7xl scroll-mt-16 px-4 py-20 sm:px-6">
          <div className="max-w-2xl">
            <p className="dg-eyebrow">Choose your way in</p>
            <h2 className="dg-display mt-3 text-3xl sm:text-5xl">On the go, build your own, or bring your own</h2>
            <p className="mt-4 text-[var(--text-3)]">Start on VOIZO&apos;s infrastructure today and switch to your own carrier whenever you like. One setting, no rebuild.</p>
          </div>
          <div className="mt-12 grid gap-4 md:grid-cols-3">
            {JOURNEYS.map(({ icon: Icon, title, body, points, cta }) => (
              <div key={title} className="dg-card flex flex-col p-7">
                <span className="flex h-10 w-10 items-center justify-center rounded-md bg-[var(--accent)]/12 text-[var(--accent)]">
                  <Icon size={19} />
                </span>
                <h3 className="mt-5 text-xl font-semibold">{title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-[var(--text-3)]">{body}</p>
                <ul className="mt-5 space-y-2.5 text-sm text-[var(--text-2)]">
                  {points.map((t) => (
                    <li key={t} className="flex items-start gap-2">
                      <Check size={15} className="mt-0.5 shrink-0 text-[var(--accent)]" /> {t}
                    </li>
                  ))}
                </ul>
                <NavLink href={cta.href} className="mt-7 inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--accent)] hover:underline">
                  {cta.label} <ArrowRight size={14} />
                </NavLink>
              </div>
            ))}
          </div>
        </section>

        {/* ── Built for scale: the safety rails ── */}
        <section id="safety" className="mx-auto max-w-7xl scroll-mt-16 px-4 pb-20 sm:px-6">
          <div className="relative overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-8 sm:p-12">
            <div aria-hidden className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full opacity-30 blur-3xl" style={{ background: "var(--dg-gradient)" }} />
            <div className="relative grid gap-10 lg:grid-cols-[1fr_1.2fr]">
              <div>
                <p className="dg-eyebrow">Built for scale</p>
                <h2 className="dg-display mt-3 text-3xl sm:text-4xl">Safety rails built in</h2>
                <p className="mt-4 text-[var(--text-3)]">
                  Do-not-call and suppression lists are checked before every dial, calls only go out inside each
                  campaign&apos;s calling window, SMS follows the consent rule you choose, and opt-outs are honoured
                  automatically.
                </p>
                <Link href="/login" className="dg-btn dg-btn-secondary mt-8">
                  Open the console <ArrowRight size={15} />
                </Link>
              </div>
              <ul className="grid gap-3 sm:grid-cols-2">
                {RAILS.map(({ icon: Icon, title, body }) => (
                  <li key={title} className="rounded-lg border border-[var(--border)] bg-[var(--bg-panel)] p-5">
                    <Icon size={18} className="text-[var(--accent)]" />
                    <p className="mt-3 text-sm font-semibold">{title}</p>
                    <p className="mt-1 text-xs leading-relaxed text-[var(--text-3)]">{body}</p>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        {/* ── Final CTA ── */}
        <section className="border-t border-[var(--border)]">
          <div className="mx-auto max-w-4xl px-4 py-24 text-center sm:px-6">
            <h2 className="dg-display text-3xl sm:text-5xl">
              Put your agents to work
              <br />
              <span className="dg-gradient-text">with one sign-in.</span>
            </h2>
            <p className="mx-auto mt-5 max-w-xl text-[var(--text-3)]">Create an account, pick an agent, add your brand and launch your first campaign today.</p>
            <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
              <Link href="/signup" className="dg-btn dg-btn-primary">
                Sign up free <ArrowRight size={15} />
              </Link>
              <a href="#agents" className="dg-btn dg-btn-secondary">Talk to an agent</a>
            </div>
          </div>
        </section>
      </main>

      {/* ── Footer ── */}
      <footer className="border-t border-[var(--border)] bg-[var(--bg-panel)]">
        <div className="mx-auto max-w-7xl px-4 py-14 sm:px-6">
          <div className="grid gap-10 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
            <div>
              <MarketingLogo />
              <p className="mt-4 max-w-xs text-sm text-[var(--text-3)]">AI voice agents ready as they are, anytime, anywhere.</p>
            </div>
            {FOOTER.map((col) => (
              <div key={col.title}>
                <p className="dg-mono text-[11px] uppercase tracking-[0.08em] text-[var(--text-3)]">{col.title}</p>
                <ul className="mt-4 space-y-2.5 text-sm">
                  {col.links.map((l) => (
                    <li key={l.label}>
                      <NavLink href={l.href} className="text-[var(--text-2)] transition-colors hover:text-[var(--text-1)]">{l.label}</NavLink>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          <div className="mt-12 flex flex-col gap-3 border-t border-[var(--border)] pt-6 text-xs text-[var(--text-4)] sm:flex-row sm:items-center sm:justify-between">
            <p>© {year} VOIZO. All rights reserved.</p>
            <p className="dg-mono uppercase tracking-[0.08em]">Numbers · SMS · Email · SIP trunk · WhatsApp</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
