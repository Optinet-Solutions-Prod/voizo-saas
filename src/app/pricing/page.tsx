import Link from "next/link";
import type { Metadata } from "next";
import { ArrowRight } from "lucide-react";
import PricingTable from "@/components/PricingTable";

export const metadata: Metadata = {
  title: "Pricing — VOIZO",
  description: "Simple plans for AI outbound calling, in USD or EUR. Start free with three ready-made agents.",
};

const PRIMARY = "#4d90f0";

const FAQ = [
  { q: "What counts as a minute?", a: "Talk time on connected calls, rounded up to the next minute. Unanswered calls and voicemail detection under 10 seconds aren't billed." },
  { q: "Can I bring my own phone numbers or telephony?", a: "Yes. Register your numbers under Settings → Phone numbers. Dialing through your own Twilio, Squaretalk or FreeSWITCH is included on Scale." },
  { q: "Do the pre-built agents cost extra?", a: "Ava, Leo and Maya are free on every plan. The other seventeen are included on Pro and Scale, or a one-off unlock each on Free and Starter." },
  { q: "How do I pay?", a: "Plans are invoiced monthly or yearly. Contact us to set up or change a plan; card self-service is coming." },
];

export default function PricingPage() {
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
            <Link href="/agents" className="hover:text-[var(--text-1)] transition-colors">Agents</Link>
            <Link href="/pricing" className="text-[var(--text-1)]">Pricing</Link>
          </div>
          <Link href="/login" className="inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-semibold text-white transition hover:brightness-110" style={{ background: PRIMARY }}>Sign in <ArrowRight size={15} /></Link>
        </nav>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.18em]" style={{ color: PRIMARY }}>Pricing</p>
          <h1 className="mt-3 text-3xl font-bold tracking-tight sm:text-5xl">Plans that grow with your call volume</h1>
          <p className="mt-4 text-[var(--text-2)]">Every plan includes the script builder, test calls and the campaign dashboard. Pick the minutes you need; upgrade any time.</p>
        </div>
        <div className="mt-10">
          <PricingTable />
        </div>
        <section className="mx-auto mt-20 max-w-3xl">
          <h2 className="text-2xl font-bold tracking-tight">Questions</h2>
          <dl className="mt-6 divide-y divide-[var(--border)] rounded-2xl border border-[var(--border)] bg-[var(--bg-card)]">
            {FAQ.map((f) => (
              <div key={f.q} className="p-5">
                <dt className="font-semibold text-[var(--text-1)]">{f.q}</dt>
                <dd className="mt-1.5 text-sm text-[var(--text-2)]">{f.a}</dd>
              </div>
            ))}
          </dl>
        </section>
      </main>
    </div>
  );
}
