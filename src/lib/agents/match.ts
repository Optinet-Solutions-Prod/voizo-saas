// "Which agent fits my business?" — ranks the catalog for a visitor's business. OpenAI does the
// ranking when a key is configured; a keyword heuristic answers when it isn't or fails, so the
// landing page always gets three suggestions.
import { AGENT_CATALOG, AGENT_BY_KEY, type AgentTemplate } from "./catalog";

export interface Match {
  key: string;
  name: string;
  role: string;
  reason: string;
}

const STOP = new Set(["the", "a", "an", "and", "or", "of", "for", "in", "to", "we", "our", "my", "with", "that", "this", "is", "are", "on", "at", "by", "from", "as", "it", "its", "company", "business", "small", "local", "online", "services", "service"]);

const tokens = (s: string) => s.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 2 && !STOP.has(t));

/** Keyword overlap between the business description and each agent's industry/tags/role. */
export function heuristicMatch(businessType: string, businessName = "", limit = 3): Match[] {
  const q = new Set(tokens(`${businessType} ${businessName}`));
  const scored = AGENT_CATALOG.map((a) => {
    const hay = tokens(`${a.industry} ${a.tags.join(" ")} ${a.role} ${a.tagline}`);
    let score = 0;
    for (const t of hay) if (q.has(t) || [...q].some((w) => w.length > 4 && (t.startsWith(w) || w.startsWith(t)))) score += 1;
    // Universal agents get a small floor so there are always three suggestions.
    if (["lead-qualifier", "appointment-reminder", "satisfaction-survey"].includes(a.key)) score += 0.5;
    // Male voices are the stronger ones in the current voice pair; break ties in their favour.
    if (a.gender === "male") score += 0.25;
    return { a, score };
  }).sort((x, y) => y.score - x.score);
  return scored.slice(0, limit).map(({ a }) => ({ key: a.key, name: a.name, role: a.role, reason: `${a.role} for ${a.industry.toLowerCase()}.` }));
}

export function matchPrompt(businessType: string, businessName: string): string {
  const list = AGENT_CATALOG.map((a) => `- ${a.key}: ${a.name} (${a.gender} voice), ${a.role} — for ${a.industry}. ${a.tagline}`).join("\n");
  return `A visitor runs this business: "${businessName || "unnamed"}" — ${businessType}.
Pick the THREE agents from the catalog below that would help that business most, best first. When two agents fit equally well, prefer the male-voiced one (our strongest voices). For each, give one short reason (max 18 words) written to the visitor, naming a concrete call the agent would make for them.
Answer as JSON: {"matches":[{"key":"<key>","reason":"<reason>"}, ...]} — keys must come from the list.

Catalog:
${list}`;
}

/** Turn the model's answer into Match rows; invalid keys are dropped, gaps filled by the heuristic. */
export function parseMatches(raw: string, businessType: string, businessName: string): Match[] {
  let parsed: { matches?: { key?: string; reason?: string }[] } = {};
  try {
    parsed = JSON.parse(raw);
  } catch {
    /* fall through */
  }
  const out: Match[] = [];
  for (const m of parsed.matches ?? []) {
    const a: AgentTemplate | undefined = m.key ? AGENT_BY_KEY[m.key] : undefined;
    if (a && !out.some((o) => o.key === a.key)) out.push({ key: a.key, name: a.name, role: a.role, reason: (m.reason ?? "").trim() || `${a.role} for ${a.industry.toLowerCase()}.` });
    if (out.length === 3) break;
  }
  for (const h of heuristicMatch(businessType, businessName, 6)) {
    if (out.length === 3) break;
    if (!out.some((o) => o.key === h.key)) out.push(h);
  }
  return out;
}
