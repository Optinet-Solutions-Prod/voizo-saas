// _gate-0910-offer-spoken.mjs — READ-ONLY. Run the SHIPPED agentSpokeOffer (not a scratch regex) over every early hang-up on
// optin_reached_only campaigns since 11 Aug, and report the hit count beside the scratch figure (351).
import { readFileSync } from "node:fs";
const mod = await import("../src/lib/transcriptClassify.ts");
const { agentSpokeOffer, substantiveUserTurnCount } = mod;
const env = {};
for (const l of readFileSync("C:/Users/jasin/Desktop/voizo/Voizo/.env.local", "utf8").split(/\r?\n/)) {
  const i = l.indexOf("="); if (i > 0 && !l.startsWith("#")) env[l.slice(0, i).trim()] = l.slice(i + 1).trim().replace(/^["']|["']$/g, "");
}
const h = { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: "Bearer " + env.SUPABASE_SERVICE_ROLE_KEY };
async function page(t, s, e) { const o = []; for (let f = 0; ; f += 1000) { const r = await fetch(env.NEXT_PUBLIC_SUPABASE_URL + "/rest/v1/" + t + "?select=" + s + (e || ""), { headers: { ...h, Range: f + "-" + (f + 999), "Range-Unit": "items", Prefer: "count=exact" } }); if (!r.ok) throw new Error(t + " " + r.status); const c = await r.json(); o.push(...c); if (c.length < 1000) return o; } }
const CONNECTED = new Set(["completed", "answered"]);
const BAIL = new Set(["customer-ended-call", "assistant-ended-call", "assistant-said-end-call-phrase", "assistant-ended-call-after-message-spoken"]);
const tt = (t) => (!t ? "" : typeof t === "string" ? t : (t.text ?? ""));
const isAT = (r) => !!r && (String(r).startsWith("pipeline-error") || r === "assistant-not-responding");
const early = (c) => { const tx = tt(c.transcript); if (c.ended_reason === "silence-timed-out") return true; if (substantiveUserTurnCount(tx) > 1) return false; if (BAIL.has(c.ended_reason ?? "")) return true; return typeof c.duration_seconds === "number" && c.duration_seconds < 15; };
const tag = (c) => { if (c.goal_reached === true) return "positive"; if (!CONNECTED.has(c.status ?? "")) return "unreachable"; if (c.voicemail === true) return "voicemail"; if (isAT(c.ended_reason)) return "agent_timeout"; if (substantiveUserTurnCount(tt(c.transcript)) === 0) return "silent_pickup"; return early(c) ? "early_hangup" : "neutral"; };
// self-test with a known-bad
if (agentSpokeOffer("AI: Have you had a chance to log in recently?\nUser: Who?") !== false) throw new Error("SELF-TEST greeting");
if (agentSpokeOffer("AI: I've added twenty free spins for you.\nUser: Bye.") !== true) throw new Error("SELF-TEST offer");
const camps = await page("campaigns_v2", "id,sms_consent_mode", "");
const mode = new Map(camps.map((c) => [c.id, c.sms_consent_mode]));
const calls = await page("calls_v2", "id,campaign_id,status,voicemail,goal_reached,duration_seconds,ended_reason,transcript,created_at", "&created_at=gte.2026-08-11T00:00:00Z&status=in.(completed,answered)");
const eh = calls.filter((c) => mode.get(c.campaign_id) === "optin_reached_only" && tag(c) === "early_hangup");
let hit = 0; const days = new Set(); const sample = [];
for (const c of eh) { if (agentSpokeOffer(tt(c.transcript))) { hit++; days.add(c.created_at.slice(0, 10)); if (sample.length < 3) sample.push(tt(c.transcript).split("\n").filter((l) => /^AI:/.test(l)).join(" ").slice(0, 150)); } }
console.log("SHIPPED agentSpokeOffer: " + hit + " of " + eh.length + " early hang-ups (" + ((hit / eh.length) * 100).toFixed(1) + "%) over " + days.size + " active days = " + (hit / Math.max(1, days.size)).toFixed(1) + " extra texts/day");
console.log("scratch lexicon said 351 of 1048; shipped differs by " + (hit - 351));
for (const s of sample) console.log("  e.g. " + s);
