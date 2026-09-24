// VOIZO plans (Phase 6, 2026-09-24). Display only for now — no card checkout; VOIZO staff set an
// organization's plan in Settings → Platform. Pure data so the public page and the console share it.
//
// Where the numbers come from (Sept 2026 research): all-inclusive voice-agent platforms bill
// $0.09–0.20 per minute in practice (Bland $0.11–0.14 on $299–499/mo plans, Autocalls from
// $0.09/min, Retell $0.07–0.18 BYOK); subscription tiers with bundled minutes run $29–$499/mo
// (Goodcall $79/129/249, Autocalls $34/129/249/419). VOIZO sits in the middle of that band with
// more included minutes per dollar than the dashboard-only tools, because the agents, script
// builder, SMS follow-up and QA judge are all in the box. EUR prices are set (not converted) at
// roughly USD × 0.92, rounded to a clean number.

export type Currency = "USD" | "EUR";
export type BillingPeriod = "monthly" | "yearly";

export interface Plan {
  key: "free" | "starter" | "pro" | "scale";
  name: string;
  tagline: string;
  /** Monthly price when billed monthly. */
  monthly: Record<Currency, number>;
  /** Monthly-equivalent price when billed yearly (≈15% off). */
  yearly: Record<Currency, number>;
  includedMinutes: number;
  /** Price per minute beyond the included ones. */
  extraMinute: Record<Currency, number>;
  users: number | "unlimited";
  brands: number | "unlimited";
  agents: string;
  features: string[];
  highlight?: boolean;
  cta: string;
}

export const PLANS: Plan[] = [
  {
    key: "free",
    name: "Free",
    tagline: "Try real calls with a ready-made agent.",
    monthly: { USD: 0, EUR: 0 },
    yearly: { USD: 0, EUR: 0 },
    includedMinutes: 60,
    extraMinute: { USD: 0.2, EUR: 0.18 },
    users: 2,
    brands: 1,
    agents: "3 free agents",
    features: ["Script builder & test calls", "VOIZO voice library", "Campaign dashboard", "Community support"],
    cta: "Start free",
  },
  {
    key: "starter",
    name: "Starter",
    tagline: "For one team running its first campaigns.",
    monthly: { USD: 49, EUR: 45 },
    yearly: { USD: 42, EUR: 39 },
    includedMinutes: 500,
    extraMinute: { USD: 0.15, EUR: 0.14 },
    users: 5,
    brands: 3,
    agents: "3 free agents + buy others one-off",
    features: ["Everything in Free", "SMS follow-up", "Customer.io & CRM integrations", "Call recordings & transcripts", "Email support"],
    cta: "Choose Starter",
  },
  {
    key: "pro",
    name: "Pro",
    tagline: "Every agent, your own voices, AI call reviews.",
    monthly: { USD: 149, EUR: 139 },
    yearly: { USD: 127, EUR: 118 },
    includedMinutes: 2000,
    extraMinute: { USD: 0.12, EUR: 0.11 },
    users: 15,
    brands: 10,
    agents: "All 20 pre-built agents",
    features: ["Everything in Starter", "Your own ElevenLabs voices", "AI QA judge & review queue", "Recurring & real-time campaigns", "Priority support"],
    highlight: true,
    cta: "Choose Pro",
  },
  {
    key: "scale",
    name: "Scale",
    tagline: "High volume, many brands, dedicated help.",
    monthly: { USD: 449, EUR: 419 },
    yearly: { USD: 382, EUR: 356 },
    includedMinutes: 8000,
    extraMinute: { USD: 0.1, EUR: 0.09 },
    users: "unlimited",
    brands: "unlimited",
    agents: "All 20 pre-built agents",
    features: ["Everything in Pro", "Bring your own telephony (Twilio, Squaretalk, FreeSWITCH)", "Dedicated success manager", "Uptime SLA", "Custom onboarding"],
    cta: "Talk to us",
  },
];

export const PLAN_BY_KEY: Record<string, Plan> = Object.fromEntries(PLANS.map((p) => [p.key, p]));

/** One-off unlock for a paid pre-built agent, per organization. */
export const AGENT_UNLOCK: Record<Currency, number> = { USD: 19, EUR: 18 };

export function formatMoney(amount: number, currency: Currency): string {
  const symbol = currency === "EUR" ? "€" : "$";
  return amount % 1 === 0 ? `${symbol}${amount}` : `${symbol}${amount.toFixed(2)}`;
}

/** Plans whose organizations get every pre-built agent without a per-agent unlock. */
export const PLANS_WITH_ALL_AGENTS = new Set(["pro", "scale"]);
