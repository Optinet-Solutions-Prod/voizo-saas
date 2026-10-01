import { NextRequest, NextResponse } from "next/server";
import { AGENT_BY_KEY } from "@/lib/agents/catalog";
import { clientIp, guardPublic } from "@/lib/rateLimit";
import { recordOpenAI } from "@/lib/usage";
import { getTenant } from "@/lib/tenant";

// POST /api/public/call-summary { agentKey, firstName, company, transcript:[{role,text}] }
// → { outcome, headline, summary, nextStep, highlights } — what the demo call achieved, for the
// card shown after a call (public modal and the in-app "Try an agent" page).

export type Outcome = "agreed" | "declined" | "callback" | "unclear" | "no_conversation";
export interface CallSummary { outcome: Outcome; headline: string; summary: string; nextStep: string; highlights: string[] }

const OUTCOMES: Outcome[] = ["agreed", "declined", "callback", "unclear", "no_conversation"];

export async function POST(request: NextRequest) {
  const rl = await guardPublic("summary", clientIp(request.headers), 12, 60 * 60_000);
  if (!rl.ok) return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  let body: { agentKey?: string; firstName?: string; company?: string; transcript?: { role?: string; text?: string }[] };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const agent = body.agentKey ? AGENT_BY_KEY[body.agentKey] : undefined;
  if (!agent) return NextResponse.json({ error: "Unknown agent" }, { status: 400 });
  const firstName = (body.firstName ?? "").trim().slice(0, 40) || "the customer";
  const company = (body.company ?? "").trim().slice(0, 80) || "the business";
  const lines = (Array.isArray(body.transcript) ? body.transcript : [])
    .filter((l) => (l.role === "assistant" || l.role === "user") && typeof l.text === "string" && l.text.trim())
    .slice(0, 80)
    .map((l) => `${l.role === "assistant" ? agent.name : firstName}: ${l.text!.trim().slice(0, 500)}`);

  if (lines.length < 2) {
    return NextResponse.json({ summary: { outcome: "no_conversation", headline: "The call ended before a conversation started", summary: `${agent.name} opened the call but there was no exchange to summarise.`, nextStep: "Try again and answer the agent; the summary will capture what you agreed.", highlights: [] } satisfies CallSummary });
  }

  const key = process.env.OPENAI_API_KEY;
  if (key) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 15_000);
      const model = "gpt-4.1-mini";
      const r = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        signal: ctrl.signal,
        body: JSON.stringify({
          model,
          temperature: 0.2,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: "You write short, plain call summaries for a business owner who just took a demo call from an AI voice agent. Be concrete: name what was discussed and what was agreed. No fluff." },
            { role: "user", content: `Agent: ${agent.name}, ${agent.role}, calling for ${company}. Customer: ${firstName}.\n\nTranscript:\n${lines.join("\n")}\n\nReturn JSON: {"outcome": one of "agreed" | "declined" | "callback" | "unclear", "headline": the result in at most 8 words, "summary": two short sentences on what was discussed and what was agreed, "nextStep": one sentence on what happens next for ${firstName}, "highlights": up to 3 short strings with facts captured or answers given}` },
          ],
        }),
      });
      clearTimeout(t);
      if (r.ok) {
        const j = (await r.json()) as { id?: string; usage?: { prompt_tokens?: number; completion_tokens?: number }; choices?: { message?: { content?: string } }[] };
        const p = JSON.parse(j.choices?.[0]?.message?.content ?? "{}") as Partial<CallSummary>;
        const summary: CallSummary = {
          outcome: OUTCOMES.includes(p.outcome as Outcome) ? (p.outcome as Outcome) : "unclear",
          headline: (p.headline ?? "").toString().trim().slice(0, 80) || "Call complete",
          summary: (p.summary ?? "").toString().trim().slice(0, 600),
          nextStep: (p.nextStep ?? "").toString().trim().slice(0, 300),
          highlights: Array.isArray(p.highlights) ? p.highlights.map((h) => String(h).trim()).filter(Boolean).slice(0, 3) : [],
        };
        const tenant = await getTenant().catch(() => null);
        void recordOpenAI({ orgId: tenant?.org?.id ?? null, kind: "call_summary", model, usage: j.usage, ref: j.id });
        return NextResponse.json({ summary, source: "openai" });
      }
    } catch {
      /* fall through */
    }
  }
  const last = lines[lines.length - 1];
  return NextResponse.json({ summary: { outcome: "unclear", headline: "Call complete", summary: `${agent.name} ran a ${agent.role.toLowerCase()} call for ${company} with ${firstName}. Last exchange: ${last}`, nextStep: "", highlights: [] } satisfies CallSummary, source: "fallback" });
}
