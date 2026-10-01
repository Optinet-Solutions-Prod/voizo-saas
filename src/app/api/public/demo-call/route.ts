import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { AGENT_BY_KEY } from "@/lib/agents/catalog";
import { demoAssistantId, demoOverrides, publicDemoCallsToday } from "@/lib/agents/demoAssistant";
import { clientIp, guardPublic, publicCountSince } from "@/lib/rateLimit";
import { verifyTurnstile } from "@/lib/turnstile";

// POST /api/public/demo-call { key, firstName, company, businessType?, turnstileToken? }
// → { assistantId, overrides, publicKey } for a browser call from the landing page (no sign-in).
// Cost guards: Turnstile (when configured), 3 calls per visitor per hour (durable, shared across
// instances), a global daily cap, and four-minute calls.
const PER_IP_PER_HOUR = 3;
const DAILY_CAP = Number(process.env.PUBLIC_DEMO_DAILY_CAP ?? 150);
const MAX_SECONDS = 240;

export async function POST(request: NextRequest) {
  const publicKey = process.env.NEXT_PUBLIC_VAPI_PUBLIC_KEY;
  if (!publicKey || !process.env.VAPI_PRIVATE_KEY) return NextResponse.json({ error: "Voice demos aren't configured on this deployment." }, { status: 503 });
  const ip = clientIp(request.headers);

  let body: { key?: string; firstName?: string; company?: string; businessType?: string; turnstileToken?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const agent = body.key ? AGENT_BY_KEY[body.key] : undefined;
  if (!agent) return NextResponse.json({ error: "Unknown agent" }, { status: 400 });
  const firstName = (body.firstName ?? "").trim().slice(0, 40);
  const company = (body.company ?? "").trim().slice(0, 80);
  const businessType = (body.businessType ?? "").trim().slice(0, 200);
  if (!firstName || !company) return NextResponse.json({ error: "Your name and business name are needed for the call" }, { status: 400 });

  const captcha = await verifyTurnstile(body.turnstileToken, ip);
  if (!captcha.ok) return NextResponse.json({ error: "We couldn't verify you're human. Reload the page and try again." }, { status: 403 });

  const rl = await guardPublic("call", ip, PER_IP_PER_HOUR, 60 * 60_000, { agentKey: agent.key });
  if (!rl.ok) return NextResponse.json({ error: `You've had ${PER_IP_PER_HOUR} demo calls this hour. Sign up for unlimited testing, or try again in ${Math.max(1, Math.ceil(rl.retryAfterSec / 60))} minutes.` }, { status: 429 });

  const since = new Date();
  since.setUTCHours(0, 0, 0, 0);
  const today = (await publicCountSince("call", since)) ?? (await publicDemoCallsToday());
  if (today >= DAILY_CAP) {
    return NextResponse.json({ error: "Today's free demo calls are all used up — sign up to keep testing, or come back tomorrow." }, { status: 429 });
  }
  try {
    const assistantId = await demoAssistantId(agent);
    const overrides = demoOverrides(agent, { firstName, company, businessType }, { maxDurationSeconds: MAX_SECONDS, publicDemo: true });
    return NextResponse.json({ assistantId, overrides, publicKey, agent: { key: agent.key, name: agent.name, role: agent.role } });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Could not prepare the call";
    Sentry.captureException(e);
    try {
      const { postSlackError } = await import("@/lib/alerts/slack");
      void postSlackError("Public demo call could not start", [msg.slice(0, 300), `agent: ${agent.key}`]);
    } catch { /* alerting is best effort */ }
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
