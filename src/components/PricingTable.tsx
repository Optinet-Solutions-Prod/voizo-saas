"use client";

import { useState } from "react";
import Link from "next/link";
import { Check } from "lucide-react";
import { AGENT_UNLOCK, PLANS, formatMoney, type BillingPeriod, type Currency } from "@/lib/pricing";

const PRIMARY = "#4d90f0";

export default function PricingTable({ currentPlan, compact }: { currentPlan?: string | null; compact?: boolean }) {
  const [currency, setCurrency] = useState<Currency>("USD");
  const [period, setPeriod] = useState<BillingPeriod>("monthly");

  const seg = "inline-flex p-[3px] gap-0.5 rounded-[10px] bg-[var(--bg-elevated)] border border-[var(--border)]";
  const segBtn = (on: boolean) => `px-3 py-1.5 rounded-[7px] text-[12.5px] font-semibold transition ${on ? "bg-primary text-white" : "text-[var(--text-3)] hover:text-[var(--text-1)]"}`;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-center gap-3">
        <div className={seg} role="group" aria-label="Billing period">
          <button type="button" onClick={() => setPeriod("monthly")} className={segBtn(period === "monthly")}>Monthly</button>
          <button type="button" onClick={() => setPeriod("yearly")} className={segBtn(period === "yearly")}>Yearly <span className="ml-1 text-[10px] opacity-80">save 15%</span></button>
        </div>
        <div className={seg} role="group" aria-label="Currency">
          <button type="button" onClick={() => setCurrency("USD")} className={segBtn(currency === "USD")}>USD $</button>
          <button type="button" onClick={() => setCurrency("EUR")} className={segBtn(currency === "EUR")}>EUR €</button>
        </div>
      </div>

      <div className={`mt-8 grid gap-4 ${compact ? "sm:grid-cols-2" : "sm:grid-cols-2 lg:grid-cols-4"}`}>
        {PLANS.map((p) => {
          const price = period === "yearly" ? p.yearly[currency] : p.monthly[currency];
          const isCurrent = currentPlan === p.key;
          return (
            <article key={p.key} className={`relative flex flex-col rounded-2xl border p-6 ${p.highlight ? "border-primary/50 bg-[var(--bg-card)] shadow-[0_0_0_1px_rgba(77,144,240,.25),0_20px_50px_-20px_rgba(77,144,240,.45)]" : "border-[var(--border)] bg-[var(--bg-card)]"}`}>
              {p.highlight && <span className="absolute -top-3 left-6 rounded-full px-2.5 py-1 text-[11px] font-semibold text-white" style={{ background: PRIMARY }}>Most popular</span>}
              {isCurrent && <span className="absolute -top-3 right-6 rounded-full border border-emerald-500/40 bg-emerald-500/15 px-2.5 py-1 text-[11px] font-semibold text-emerald-300">Your plan</span>}
              <h3 className="text-lg font-semibold text-[var(--text-1)]">{p.name}</h3>
              <p className="mt-1 text-sm text-[var(--text-3)]">{p.tagline}</p>
              <div className="mt-5 flex items-baseline gap-1">
                <span className="text-4xl font-bold tracking-tight text-[var(--text-1)]">{formatMoney(price, currency)}</span>
                <span className="text-sm text-[var(--text-3)]">/month</span>
              </div>
              {period === "yearly" && price > 0 && <p className="mt-1 text-[11px] text-[var(--text-4)]">billed {formatMoney(price * 12, currency)} a year</p>}
              <dl className="mt-5 grid grid-cols-2 gap-x-3 gap-y-2 rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] p-3 text-xs">
                <dt className="text-[var(--text-3)]">Minutes</dt><dd className="text-right font-mono text-[var(--text-1)]">{p.includedMinutes.toLocaleString()}</dd>
                <dt className="text-[var(--text-3)]">Extra minute</dt><dd className="text-right font-mono text-[var(--text-1)]">{formatMoney(p.extraMinute[currency], currency)}</dd>
                <dt className="text-[var(--text-3)]">Users</dt><dd className="text-right font-mono text-[var(--text-1)]">{p.users === "unlimited" ? "∞" : p.users}</dd>
                <dt className="text-[var(--text-3)]">Brands</dt><dd className="text-right font-mono text-[var(--text-1)]">{p.brands === "unlimited" ? "∞" : p.brands}</dd>
              </dl>
              <p className="mt-4 text-sm font-medium text-[var(--text-2)]">{p.agents}</p>
              <ul className="mt-3 space-y-2 text-sm text-[var(--text-2)]">
                {p.features.map((f) => <li key={f} className="flex items-start gap-2"><Check size={15} className="mt-0.5 shrink-0" style={{ color: PRIMARY }} /> {f}</li>)}
              </ul>
              <div className="mt-6 pt-2">
                {isCurrent ? (
                  <span className="inline-flex h-10 w-full items-center justify-center rounded-xl border border-[var(--border)] text-sm font-semibold text-[var(--text-3)]">Current plan</span>
                ) : (
                  <Link href={p.key === "scale" ? "mailto:hello@voizo.ai?subject=VOIZO%20Scale%20plan" : currentPlan ? "mailto:hello@voizo.ai?subject=VOIZO%20plan%20change" : "/signup"}
                    className={`inline-flex h-10 w-full items-center justify-center rounded-xl text-sm font-semibold transition hover:brightness-110 ${p.highlight ? "text-white" : "border border-[var(--border-2)] bg-[var(--bg-elevated)] text-[var(--text-1)]"}`}
                    style={p.highlight ? { background: PRIMARY } : undefined}>
                    {currentPlan ? (p.key === "scale" ? "Talk to us" : "Switch plan") : p.cta}
                  </Link>
                )}
              </div>
            </article>
          );
        })}
      </div>

      <p className="mt-6 text-center text-xs text-[var(--text-3)]">
        Prices exclude VAT. Minutes are talk time on connected calls. Paid pre-built agents are {formatMoney(AGENT_UNLOCK[currency], currency)} one-off each on Free and Starter, and included on Pro and Scale. Telephony and SMS carrier charges are passed through at cost.
      </p>
    </div>
  );
}
