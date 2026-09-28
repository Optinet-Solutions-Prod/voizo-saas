// "Try an agent": turn a catalog agent into a complete, self-contained Vapi assistant for a
// browser demo call. No script engine, no webhooks, no database — the whole conversation is in
// the system prompt, so it works the moment someone enters their name and brand.
import type { AgentTemplate } from "./catalog";

export interface DemoInput {
  company: string;
  firstName: string;
  /** Override the agent's library voice (an ElevenLabs voice id). */
  voiceId?: string;
}

/** Demo values for the placeholders the flows use, keyed by placeholder name. */
export const DEMO_DEFAULTS: Record<string, string> = {
  appointment_date: "tomorrow",
  appointment_time: "10:30 in the morning",
  product: "our service",
  amount: "84 dollars",
  due_date: "this Friday",
  plan_date: "next Friday",
  discount: "10 percent",
  shipping_info: "free on orders over 50 dollars",
  policy_type: "car insurance",
  renewal_date: "the 15th of next month",
  property: "the two-bedroom flat on Elm Street",
  price: "350 thousand",
  offer: "your first month free",
  role: "warehouse team leader",
  schedule: "weekday shifts, 8 to 4",
  requirement: "a forklift licence",
  pay: "16 dollars an hour",
  location: "the north depot",
  vehicle: "car",
  service_type: "annual service",
  event: "our annual growth summit",
  event_date: "the 12th of November",
  venue: "the city conference centre",
  plan: "free trial",
  expires_or_renews: "ends",
  date: "Friday",
  party_size: "four people",
  time: "7:30 in the evening",
  faq_answer: "parking is free behind the building, and we cater for all allergies",
  course: "the Digital Marketing diploma",
  start_date: "September",
  duration: "12 weeks, two evenings a week",
  fee: "1,200 dollars",
  program: "loyalty club",
  scope: "everything in store and online",
  code: "WELCOME25",
  bonus: "a 100 percent match on your next deposit plus 50 free spins",
  terms: "20 times wagering, valid for 7 days",
  impact: "plant over two thousand trees along the estuary",
  order: "order",
  window: "9 in the morning and 1 in the afternoon",
  link: "a link by text message",
};

/** Replace {{placeholders}} with the demo values; unknown ones become a neutral phrase. */
export function fillPlaceholders(text: string, input: DemoInput): string {
  const map: Record<string, string> = { ...DEMO_DEFAULTS, company: input.company, first_name: input.firstName, brand: input.company };
  return text.replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (_, k: string) => map[k.toLowerCase()] ?? "the details");
}

function clean(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/** The system prompt for a demo call: persona + the whole flow as guidance. */
export function composeDemoPrompt(agent: AgentTemplate, input: DemoInput): string {
  const f = (s: string) => clean(fillPlaceholders(s, input));
  const flow = agent.flow;
  const lines: string[] = [];
  lines.push(f(agent.persona));
  lines.push("");
  lines.push(`This is a live demonstration call. The person on the line is ${input.firstName}, who asked to hear how you handle a "${agent.role}" call for ${input.company}. Treat them as the customer and run the call for real: they already know you are an AI, so don't break character to say so unless they ask.`);
  lines.push("");
  lines.push("HOW THE CALL GOES");
  lines.push(`1. Opening (you already said it as your first message): "${f(flow.opening)}"`);
  lines.push(`2. Reason for the call: "${f(flow.value)}"`);
  lines.push(`3. If they ${f(flow.positive.trigger).toLowerCase()} — ${f(flow.positive.name).toLowerCase()} — say: "${f(flow.positive.reply)}"${flow.sms ? ` Then tell them the text message is on its way (in this demo, describe it instead of sending: "${f(flow.sms)}").` : ""}`);
  flow.objections.forEach((o, i) => {
    const next = o.next === "value" ? "then return to the reason for the call" : o.next === "sms" ? "then mention the text message and wrap up" : o.next === "positive" ? "then continue as if they said yes" : "then say goodbye";
    lines.push(`${4 + i}. If they ${f(o.trigger).toLowerCase()} — ${f(o.name).toLowerCase()} — say: "${f(o.reply)}" and ${next}.`);
  });
  lines.push(`${4 + flow.objections.length}. Goodbye: "${f(flow.goodbye)}" Then end the call.`);
  lines.push("");
  lines.push("MUST COVER");
  for (const g of flow.goals) lines.push(`- ${f(g)}`);
  lines.push("");
  lines.push("STYLE");
  lines.push("- Sound like a real person on the phone: short sentences, one question at a time, natural pauses, no lists or headings.");
  lines.push("- Use the lines above as your guide, in your own words; never read placeholders or brackets aloud.");
  lines.push("- If they ask something outside the script, answer briefly and steer back.");
  lines.push("- When the conversation is done, say the goodbye and end the call.");
  return lines.join("\n");
}

/** The transient Vapi assistant for the web SDK's start(). */
export function composeDemoAssistant(agent: AgentTemplate, input: DemoInput) {
  const company = clean(input.company) || "our company";
  const firstName = clean(input.firstName) || "there";
  const inp = { ...input, company, firstName };
  return {
    name: `Demo · ${agent.name} — ${agent.role}`,
    firstMessage: clean(fillPlaceholders(agent.flow.opening, inp)),
    firstMessageMode: "assistant-speaks-first" as const,
    model: {
      provider: "openai" as const,
      model: "gpt-4.1" as const,
      temperature: 0.6,
      maxTokens: 220,
      messages: [{ role: "system" as const, content: composeDemoPrompt(agent, inp) }],
    },
    voice: {
      provider: "11labs" as const,
      voiceId: input.voiceId || agent.voiceId,
      model: "eleven_turbo_v2_5" as const,
      stability: 0.5,
      similarityBoost: 0.75,
      speed: 1.0,
      optimizeStreamingLatency: 3,
    },
    transcriber: { provider: "deepgram" as const, model: "nova-3" as const, language: "en" as const },
    silenceTimeoutSeconds: 40,
    maxDurationSeconds: 420,
    endCallMessage: clean(fillPlaceholders(agent.flow.goodbye, inp)),
    endCallFunctionEnabled: true,
    backgroundSound: "office" as const,
    metadata: { voizoDemo: true, agentKey: agent.key },
  };
}
