import Link from "next/link";
import type { Metadata } from "next";
import {
  ArrowRight, BarChart3, Bot, CalendarClock, CheckCircle2, MessageSquareText, PhoneCall,
  ShieldCheck, Sparkles, Workflow,
} from "lucide-react";

export const metadata: Metadata = {
  title: "VOIZO — AI voice agents for outbound calling",
  description:
    "Build AI voice agents, run outbound call campaigns, follow up by SMS and see what every call achieved.",
};

// Public landing page (the middleware leaves "/" open). Server-rendered, no data fetches.
// Colors come from the theme tokens so it follows the dark/light toggle like the console.

const PRIMARY = "#4d90f0";

const FEATURES = [
  {
    icon: Bot,
    title: "AI voice agents",
    body: "Give each agent a voice, a persona and a prompt. Every campaign runs its own frozen copy, so editing an agent never disturbs a live campaign.",
    tint: "#4d90f0",
  },
  {
    icon: Workflow,
    title: "Script builder & lab",
    body: "Map the conversation as a flow of stages and answers, then test it with a real call in the lab before a single customer hears it.",
    tint: "#8b7cf6",
  },
  {
    icon: CalendarClock,
    title: "Campaigns that run themselves",
    body: "One-off, recurring or real-time campaigns with calling windows, per-country caller IDs and concurrency limits you control.",
    tint: "#22b8a7",
  },
  {
    icon: MessageSquareText,
    title: "SMS follow-up",
    body: "Send the offer by text after the call, with consent rules per campaign and de-duplication so nobody gets the same message twice.",
    tint: "#f0a04d",
  },
  {
    icon: Sparkles,
    title: "AI call reviews",
    body: "An LLM judge scores conversations against your rubric, and a review queue lets your team label the calls that matter.",
    tint: "#e46fa5",
  },
  {
    icon: BarChart3,
    title: "Analytics that add up",
    body: "Reach, pickups, conversations, opt-ins and cost per campaign, with exports for your CRM and a daily snapshot of the numbers.",
    tint: "#5fb85f",
  },
];

const STEPS = [
  { n: "01", title: "Build your agent", body: "Pick a voice, write the persona and script, and test it live in the lab." },
  { n: "02", title: "Launch a campaign", body: "Upload an audience, set calling windows and caller IDs, and press start." },
  { n: "03", title: "Review and improve", body: "Read transcripts, let the AI judge score them, and tune the script from what works." },
];

const TRANSCRIPT = [
  { who: "agent", text: "Hi, it's Ava calling. Have you got a minute?" },
  { who: "person", text: "Sure, what's it about?" },
  { who: "agent", text: "You have a welcome offer waiting. Shall I text you the details?" },
  { who: "person", text: "Yes, go ahead." },
];

function Logo() {
  return (
    <Link href="/" className="flex items-center gap-2.5" aria-label="VOIZO home">
      <span
        className="w-9 h-9 rounded-xl flex items-center justify-center"
        style={{ background: "linear-gradient(145deg,#4d90f0,#3a6fd0)", boxShadow: "0 2px 10px rgba(77,144,240,.35)" }}
      >
        <span className="text-white text-sm font-bold">V</span>
      </span>
      <span className="font-bold tracking-tight text-[var(--text-1)]">VOIZO</span>
    </Link>
  );
}

function CallCard() {
  return (
    <div className="lp-float relative w-full max-w-md">
      {/* soft glow behind the card */}
      <div
        aria-hidden
        className="absolute -inset-6 rounded-[2rem] blur-3xl opacity-40"
        style={{ background: `radial-gradient(60% 60% at 50% 40%, ${PRIMARY}, transparent)` }}
      />
      <div className="relative rounded-3xl border border-[var(--border-2)] bg-[var(--bg-card)] shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)]">
          <div className="flex items-center gap-3">
            <span className="relative flex h-9 w-9 items-center justify-center rounded-full" style={{ background: `${PRIMARY}22` }}>
              <span className="lp-ping absolute inset-0 rounded-full" style={{ background: `${PRIMARY}55` }} />
              <PhoneCall size={16} style={{ color: PRIMARY }} />
            </span>
            <div className="leading-tight">
              <p className="text-sm font-semibold text-[var(--text-1)]">Live call</p>
              <p className="text-[11px] text-[var(--text-3)]">Agent “Ava” · sample conversation</p>
            </div>
          </div>
          <span className="font-mono text-xs text-[var(--text-2)]">00:42</span>
        </div>

        {/* waveform */}
        <div className="flex items-center justify-center gap-[3px] h-14 px-5 border-b border-[var(--border)]" aria-hidden>
          {Array.from({ length: 36 }).map((_, i) => (
            <span
              key={i}
              className="lp-wave-bar w-[3px] rounded-full"
              style={{
                height: `${20 + ((i * 37) % 60)}%`,
                background: i % 5 === 0 ? PRIMARY : "var(--border-2)",
                animationDelay: `${(i % 9) * 0.11}s`,
              }}
            />
          ))}
        </div>

        <div className="space-y-2.5 px-5 py-4">
          {TRANSCRIPT.map((line, i) => (
            <div key={i} className={`flex ${line.who === "agent" ? "justify-start" : "justify-end"}`}>
              <p
                className={`max-w-[80%] rounded-2xl px-3.5 py-2 text-[13px] leading-snug ${
                  line.who === "agent"
                    ? "bg-[var(--bg-elevated)] text-[var(--text-1)] rounded-bl-md"
                    : "text-white rounded-br-md"
                }`}
                style={line.who === "agent" ? undefined : { background: PRIMARY }}
              >
                {line.text}
              </p>
            </div>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2 px-5 py-3.5 border-t border-[var(--border)] bg-[var(--bg-panel)]">
          <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium text-emerald-400 bg-emerald-500/10">
            <CheckCircle2 size={12} /> Opted in
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium text-[var(--text-2)] bg-[var(--bg-elevated)]">
            <MessageSquareText size={12} /> SMS queued
          </span>
          <span className="ml-auto text-[11px] text-[var(--text-3)]">AI score pending</span>
        </div>
      </div>
    </div>
  );
}

export default function LandingPage() {
  return (
    <div className="relative min-h-screen overflow-x-hidden text-[var(--text-1)]">
      {/* backdrop: a primary-tinted glow over the app ground (the global dot-field shows through) */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-[720px] -z-[1]"
        style={{ background: `radial-gradient(50% 60% at 50% 0%, ${PRIMARY}2e, transparent 70%)` }}
      />

      {/* ── Nav ── */}
      <header className="sticky top-0 z-30 border-b border-[var(--border)] bg-[color-mix(in_srgb,var(--bg-app)_80%,transparent)] backdrop-blur-md">
        <nav className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
          <Logo />
          <div className="hidden md:flex items-center gap-8 text-sm text-[var(--text-2)]">
            <a href="#features" className="hover:text-[var(--text-1)] transition-colors">Features</a>
            <a href="#how" className="hover:text-[var(--text-1)] transition-colors">How it works</a>
            <a href="#compliance" className="hover:text-[var(--text-1)] transition-colors">Compliance</a>
          </div>
          <Link
            href="/login"
            className="inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-semibold text-white transition hover:brightness-110"
            style={{ background: PRIMARY }}
          >
            Sign in <ArrowRight size={15} />
          </Link>
        </nav>
      </header>

      <main>
        {/* ── Hero ── */}
        <section className="mx-auto grid max-w-6xl items-center gap-14 px-4 pb-20 pt-16 sm:px-6 md:pt-24 lg:grid-cols-[1.1fr_1fr]">
          <div>
            <span className="inline-flex items-center gap-2 rounded-full border border-[var(--border-2)] bg-[var(--bg-card)] px-3 py-1 text-xs text-[var(--text-2)]">
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: PRIMARY }} />
              AI outbound calling platform
            </span>
            <h1 className="mt-6 text-[2rem] font-bold leading-[1.08] tracking-tight sm:text-5xl lg:text-[3.1rem]">
              Voice agents that call,
              <br />
              <span
                className="bg-clip-text text-transparent"
                style={{ backgroundImage: `linear-gradient(90deg, ${PRIMARY}, #8b7cf6)` }}
              >
                convert and follow up.
              </span>
            </h1>
            <p className="mt-6 max-w-xl text-base leading-relaxed text-[var(--text-2)] sm:text-lg">
              VOIZO runs your outbound campaigns with AI voice agents: it dials your audience inside
              the windows you set, holds natural conversations, texts the offer to people who opt in,
              and shows you what every call achieved.
            </p>
            <div className="mt-9 flex flex-wrap items-center gap-3">
              <Link
                href="/login"
                className="inline-flex items-center gap-2 rounded-xl px-5 py-3 text-sm font-semibold text-white shadow-lg transition hover:brightness-110"
                style={{ background: PRIMARY, boxShadow: `0 8px 24px ${PRIMARY}40` }}
              >
                Open the console <ArrowRight size={16} />
              </Link>
              <a
                href="#how"
                className="inline-flex items-center gap-2 rounded-xl border border-[var(--border-2)] bg-[var(--bg-card)] px-5 py-3 text-sm font-semibold text-[var(--text-1)] transition hover:bg-[var(--bg-hover)]"
              >
                See how it works
              </a>
            </div>
            <ul className="mt-10 flex flex-wrap gap-x-6 gap-y-2 text-sm text-[var(--text-3)]">
              {["Natural-sounding voices", "Recurring & real-time campaigns", "Built-in call QA"].map((t) => (
                <li key={t} className="flex items-center gap-2">
                  <CheckCircle2 size={15} style={{ color: PRIMARY }} /> {t}
                </li>
              ))}
            </ul>
          </div>
          <div className="flex justify-center lg:justify-end">
            <CallCard />
          </div>
        </section>

        {/* ── Features ── */}
        <section id="features" className="scroll-mt-20 mx-auto max-w-6xl px-4 py-20 sm:px-6">
          <div className="max-w-2xl">
            <p className="text-xs font-semibold uppercase tracking-[0.18em]" style={{ color: PRIMARY }}>Features</p>
            <h2 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">Everything a calling team needs, in one console</h2>
            <p className="mt-4 text-[var(--text-2)]">From the first draft of a script to the report on how it performed.</p>
          </div>
          <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map(({ icon: Icon, title, body, tint }) => (
              <div
                key={title}
                className="glow-card rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-6"
                style={{ "--glow-color": tint } as React.CSSProperties}
              >
                <span className="flex h-10 w-10 items-center justify-center rounded-xl" style={{ background: `${tint}1f`, color: tint }}>
                  <Icon size={19} />
                </span>
                <h3 className="mt-5 font-semibold text-[var(--text-1)]">{title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-[var(--text-2)]">{body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ── How it works ── */}
        <section id="how" className="scroll-mt-20 border-y border-[var(--border)] bg-[var(--bg-panel)]">
          <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
            <p className="text-xs font-semibold uppercase tracking-[0.18em]" style={{ color: PRIMARY }}>How it works</p>
            <h2 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">From idea to live calls in three steps</h2>
            <ol className="mt-12 grid gap-6 md:grid-cols-3">
              {STEPS.map((s) => (
                <li key={s.n} className="relative rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-6">
                  <span className="font-mono text-sm font-semibold" style={{ color: PRIMARY }}>{s.n}</span>
                  <h3 className="mt-3 text-lg font-semibold">{s.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-[var(--text-2)]">{s.body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* ── Compliance ── */}
        <section id="compliance" className="scroll-mt-20 mx-auto max-w-6xl px-4 py-20 sm:px-6">
          <div className="grid items-center gap-10 rounded-3xl border border-[var(--border)] bg-[var(--bg-card)] p-8 sm:p-12 lg:grid-cols-[auto_1fr]">
            <span className="flex h-16 w-16 items-center justify-center rounded-2xl" style={{ background: `${PRIMARY}1f`, color: PRIMARY }}>
              <ShieldCheck size={30} />
            </span>
            <div>
              <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">Safety rails built in</h2>
              <p className="mt-3 max-w-3xl text-[var(--text-2)]">
                Do-not-call and suppression lists are checked before every dial, calls only go out inside
                each campaign’s calling window, SMS follows the consent rule you choose, and opt-outs are
                honoured automatically.
              </p>
            </div>
          </div>
        </section>

        {/* ── Final CTA ── */}
        <section className="mx-auto max-w-6xl px-4 pb-24 sm:px-6">
          <div
            className="relative overflow-hidden rounded-3xl px-8 py-14 text-center sm:px-12"
            style={{ background: `linear-gradient(135deg, ${PRIMARY}, #3a6fd0 55%, #6b5cd6)` }}
          >
            <h2 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">Ready to put your agents to work?</h2>
            <p className="mx-auto mt-4 max-w-xl text-white/80">Sign in to build an agent, test it in the lab and launch your first campaign.</p>
            <Link
              href="/login"
              className="mt-8 inline-flex items-center gap-2 rounded-xl bg-white px-6 py-3 text-sm font-semibold text-[#1f3f7a] transition hover:bg-white/90"
            >
              Sign in <ArrowRight size={16} />
            </Link>
          </div>
        </section>
      </main>

      <footer className="border-t border-[var(--border)]">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-4 py-8 text-sm text-[var(--text-3)] sm:flex-row sm:px-6">
          <Logo />
          <p>© {new Date().getFullYear()} VOIZO. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
}
