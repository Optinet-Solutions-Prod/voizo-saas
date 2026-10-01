// "Try an agent": turn a catalog agent into a complete, self-contained Vapi assistant for a
// browser demo call. No script engine, no webhooks, no database — the whole conversation is in
// the system prompt, so it works the moment someone enters their name and brand.
import type { AgentDemoFraming, AgentTemplate } from "./catalog";

export interface DemoInput {
  company: string;
  firstName: string;
  /** What the business does (from the public demo form); makes the call about their business. */
  businessType?: string;
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
export function fillPlaceholders(text: string, input: DemoInput, framing?: AgentDemoFraming): string {
  const sub = (t: string, map: Record<string, string>) => t.replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (_, k: string) => map[k.toLowerCase()] ?? "the details");
  const base: Record<string, string> = { ...DEMO_DEFAULTS, first_name: input.firstName, business: input.company };
  // Selling TO the visitor's business: {{company}} is the seller the agent works for, and
  // {{product}} is what the seller offers that business.
  const map: Record<string, string> = framing
    ? { ...base, company: framing.seller, brand: framing.seller, product: sub(framing.product, base) }
    : { ...base, company: input.company, brand: input.company };
  return sub(text, map);
}

function clean(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/** "Just to check, am I speaking with Chris?" — or, with no usable name, who is speaking. */
export function demoIdentityQuestion(firstName: string): string {
  const name = clean(firstName);
  return name && name.toLowerCase() !== "there" ? `Just to check, am I speaking with ${name}?` : "Just to check, who am I speaking with?";
}

/** The system prompt for a demo call: persona + the whole flow as guidance. */
export function composeDemoPrompt(agent: AgentTemplate, input: DemoInput): string {
  const framing = agent.demo;
  const f = (s: string) => clean(fillPlaceholders(s, input, framing));
  const flow = agent.flow;
  const kind = input.businessType ? ` (${clean(input.businessType)})` : "";
  const lines: string[] = [];
  lines.push(f(agent.persona));
  lines.push("");
  if (framing) {
    // The agent sells TO businesses: the visitor's business is the prospect being called.
    lines.push(`This is a live demonstration call. You work for ${framing.seller}, ${framing.sellerAbout}. Your role on this call: ${agent.role}. The person on the line is ${input.firstName} from ${input.company}${kind}, a business owner who just requested a quote from ${framing.seller} for ${f("{{product}}")}. They are your prospect. Run the call for real: they already know you are an AI, so don't break character to say so unless they ask.`);
    lines.push(f(framing.tailor));
    if (input.businessType) lines.push(`Make every example fit a business like theirs (${clean(input.businessType)}).`);
  } else {
    lines.push(`This is a live demonstration call. Your role on this call: ${agent.role}, calling on behalf of ${input.company}${kind}. The person on the line is ${input.firstName}, who asked to hear how you handle that call for ${input.company}. Treat them as one of ${input.company}'s customers and run the call for real: they already know you are an AI, so don't break character to say so unless they ask.`);
    if (input.businessType) lines.push(`Make every detail fit a business like that (${clean(input.businessType)}): name the real products or services it would offer instead of a vague "our service", and keep the reasons for the call and your examples true to that kind of business.`);
  }
  lines.push("");
  lines.push("HOW THE CALL GOES");
  lines.push(`1. Opening (you already said it as your first message): "${f(flow.opening)}"`);
  // Identity check by name right after the greeting (Chris, 2026-10-01) — the same step the
  // installed scripts run (scriptGraph.ts); no usable name → ask who is speaking instead.
  lines.push(`2. Identity check — as soon as they answer, ask: "${demoIdentityQuestion(input.firstName)}" If they confirm (or give their name), carry on. If it's the wrong person or they're not available, apologise for the mix-up, say you'll leave it there, and end the call.`);
  lines.push(`3. Reason for the call: "${f(flow.value)}"`);
  lines.push(`4. If they ${f(flow.positive.trigger).toLowerCase()} — ${f(flow.positive.name).toLowerCase()} — say: "${f(flow.positive.reply)}"${flow.sms ? " Then say a quick text with the details is on its way (one short line; never read the message out)." : ""}`);
  flow.objections.forEach((o, i) => {
    const next = o.next === "value" ? "then return to the reason for the call" : o.next === "sms" ? "then say a text is on its way and wrap up" : o.next === "positive" ? "then continue as if they said yes" : "then say goodbye";
    lines.push(`${5 + i}. If they ${f(o.trigger).toLowerCase()} — ${f(o.name).toLowerCase()} — say: "${f(o.reply)}" and ${next}.`);
  });
  lines.push(`${5 + flow.objections.length}. Wrap-up: one short, warm line of reassurance — what's agreed, what happens next, and that there's nothing more they need to do (for example: "You're all set, ${input.firstName} — that's on its way and there's nothing else you need to do. Any questions, just give us a shout.").`);
  lines.push(`${6 + flow.objections.length}. Goodbye: "${f(flow.goodbye)}" Say it once, right after the wrap-up, then end the call straight away with the end-call function. Never say goodbye twice.`);
  lines.push("");
  lines.push("MUST COVER");
  for (const g of flow.goals) lines.push(`- ${f(g)}`);
  lines.push("");
  lines.push("STYLE");
  lines.push("- Casual and warm, like a friendly colleague on the phone: contractions, everyday words, no corporate phrases, no lists.");
  lines.push("- Keep every turn to one or two short sentences, under 25 words. One question at a time, then stop and listen.");
  lines.push("- Use the lines above as a guide, in your own words; never read placeholders, brackets, legal or opt-out text aloud.");
  lines.push("- If they ask something off-script, answer in a sentence and steer back.");
  lines.push("- Don't repeat yourself. When the conversation is done, give the one-line wrap-up, say the goodbye once and end the call.");
  return lines.join("\n");
}

/** The transient Vapi assistant for the web SDK's start(). */
export function composeDemoAssistant(agent: AgentTemplate, input: DemoInput) {
  const company = clean(input.company) || "our company";
  const firstName = clean(input.firstName) || "there";
  const inp = { ...input, company, firstName };
  return {
    name: `Demo · ${agent.name} — ${agent.role}`,
    firstMessage: clean(fillPlaceholders(agent.flow.opening, inp, agent.demo)),
    firstMessageMode: "assistant-speaks-first" as const,
    model: {
      provider: "openai" as const,
      model: "gpt-4.1" as const,
      temperature: 0.7,
      maxTokens: 120,
      messages: [{ role: "system" as const, content: composeDemoPrompt(agent, inp) }],
    },
    voice: {
      provider: "11labs" as const,
      voiceId: input.voiceId || agent.voiceId,
      model: "eleven_turbo_v2_5" as const,
      stability: 0.5,
      similarityBoost: 0.75,
      speed: 1.1,
      optimizeStreamingLatency: 3,
    },
    transcriber: { provider: "deepgram" as const, model: "nova-3" as const, language: "en" as const },
    silenceTimeoutSeconds: 40,
    maxDurationSeconds: 420,
    // The model says the goodbye itself; a Vapi end-call message would play a second goodbye.
    endCallMessage: "",
    endCallFunctionEnabled: true,
    backgroundSound: "office" as const,
    metadata: { voizoDemo: true, agentKey: agent.key },
  };
}
