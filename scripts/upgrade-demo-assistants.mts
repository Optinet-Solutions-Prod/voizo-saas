// Bring every persistent "Demo · <agent>" Vapi assistant up to the current composeDemoAssistant
// config (creates missing ones). Run after changing src/lib/agents/demo.ts and bumping
// DEMO_VERSION in src/lib/agents/demoAssistant.ts:
//   npx tsx --env-file=.env.local scripts/upgrade-demo-assistants.mts
import { AGENT_CATALOG } from "../src/lib/agents/catalog";
import { DEMO_VERSION, demoAssistantId } from "../src/lib/agents/demoAssistant";

const H = { Authorization: `Bearer ${process.env.VAPI_PRIVATE_KEY}` };
let n = 0;
for (const a of AGENT_CATALOG) { await demoAssistantId(a); n++; }
console.log("assistants ensured:", n);

const list = (await (await fetch("https://api.vapi.ai/assistant?limit=100", { headers: H })).json()) as { metadata?: { voizoDemo?: boolean; agentKey?: string; voizoDemoVersion?: number }; endCallMessage?: string; voice?: { speed?: number }; model?: { maxTokens?: number } }[];
const demos = list.filter((x) => x.metadata?.voizoDemo);
const current = demos.filter((x) => x.metadata?.voizoDemoVersion === DEMO_VERSION).length;
console.log(`demo assistants: ${demos.length} | at current version: ${current}`);
const one = demos.find((x) => x.metadata?.agentKey === "appointment-reminder");
console.log("appointment-reminder → endCallMessage:", JSON.stringify(one?.endCallMessage ?? null), "| voice speed:", one?.voice?.speed, "| maxTokens:", one?.model?.maxTokens);
