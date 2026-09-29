import { NextRequest, NextResponse } from "next/server";
import { heuristicMatch, matchPrompt, parseMatches } from "@/lib/agents/match";
import { clientIp, rateLimit } from "@/lib/rateLimit";

// POST /api/public/agent-match { businessType, businessName? } → { matches: [{key,name,role,reason}×3], source }
// Public (landing page). OpenAI ranks when a key exists; keyword heuristic otherwise.
export async function POST(request: NextRequest) {
  const rl = rateLimit(`match:${clientIp(request.headers)}`, 20, 60 * 60_000);
  if (!rl.ok) return NextResponse.json({ error: "Too many requests — try again in a few minutes." }, { status: 429 });
  let body: { businessType?: string; businessName?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const businessType = (body.businessType ?? "").trim().slice(0, 200);
  const businessName = (body.businessName ?? "").trim().slice(0, 80);
  if (businessType.length < 3) return NextResponse.json({ error: "Tell us what your business does" }, { status: 400 });

  const key = process.env.OPENAI_API_KEY;
  if (key) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 12_000);
      const r = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        signal: ctrl.signal,
        body: JSON.stringify({
          model: "gpt-4.1-mini",
          temperature: 0.3,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: "You match businesses to AI voice-agent templates. Answer only with the JSON asked for." },
            { role: "user", content: matchPrompt(businessType, businessName) },
          ],
        }),
      });
      clearTimeout(t);
      if (r.ok) {
        const j = (await r.json()) as { choices?: { message?: { content?: string } }[] };
        const matches = parseMatches(j.choices?.[0]?.message?.content ?? "", businessType, businessName);
        return NextResponse.json({ matches, source: "openai" });
      }
    } catch {
      /* fall back */
    }
  }
  return NextResponse.json({ matches: heuristicMatch(businessType, businessName), source: "heuristic" });
}
