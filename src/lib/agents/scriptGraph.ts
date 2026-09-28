// Builds a Script Builder script for a catalog agent in the same architecture the production
// team used for their best-performing script (2026-09): an agent-first opener, a pitch that
// hints there is more, a details step that offers the text message, follow-up-question loops
// that never "end on a dead beat", a polite decline route, a floating Call Goal checklist and
// two goodbyes. Content is generic and brand-safe; the company name is filled in at install and
// the customer's name stays as the engine variable {{playerName}}.
//
// Pure: returns a spec with ids already generated (inject `uuid` for deterministic tests).
// install.ts persists it with the same handler shapes the builder creates by hand:
//   reply detector = routing-only handler (action_type "ignore", mode "listener", empty line)
//   spoken line    = "answer" / "end_call" handler (mode "both", delivery "reword")
import type { AgentTemplate } from "./catalog";

export interface HandlerSpec {
  /** Symbolic key used by nodes/edges/collection before persistence. */
  key: string;
  name: string;
  intent_key: string;
  description: string;
  response_template: string;
  action_type: "answer" | "end_call" | "send_sms" | "ignore";
  delivery: "verbatim" | "reword";
  mode: "listener" | "both";
  /** Reply detectors are routing plumbing and never join the playbook collection. */
  detector: boolean;
}

export interface Connector {
  id: string;
  intentKey: string;
  label: string;
  any?: boolean;
  quickWords?: string;
}

export interface NodeSpec {
  id: string;
  type: "start" | "step";
  label: string;
  /** Symbolic handler key for end boxes (their goodbye line); resolved to scenario_id at install. */
  scenarioKey?: string;
  config: Record<string, unknown>;
  pos_x: number;
  pos_y: number;
}

export interface EdgeSpec {
  id: string;
  source_node_id: string;
  target_node_id: string;
  condition: Record<string, unknown>;
  label: string;
}

export interface ScriptSpec {
  name: string;
  description: string;
  persona: string;
  voiceId: string;
  handlers: HandlerSpec[];
  collection: { name: string; description: string; memberKeys: string[] };
  nodes: NodeSpec[];
  edges: EdgeSpec[];
}

export interface BuildOptions {
  company: string;
  /** Unique per install so two copies never share a scenario. */
  suffix: string;
  uuid?: () => string;
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 40) || "reply";
const snip = (s: string, n = 40) => (s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s);

export function buildAgentScript(agent: AgentTemplate, opts: BuildOptions): ScriptSpec {
  const uuid = opts.uuid ?? (() => crypto.randomUUID());
  const company = opts.company.trim() || "the company";
  const fill = (s: string) => s.split("{{company}}").join(company).split("{{brand}}").join(company).split("{{first_name}}").join("{{playerName}}");
  const f = agent.flow;
  const scriptName = `${agent.name} — ${agent.role}`;
  const ik = (k: string) => `${slug(k)}_${opts.suffix}`;

  // ── Persona, in the production layout ──
  const identity = fill(agent.persona.split(" Warm, concise")[0].trim());
  const persona = [
    `[Identity] ${identity} Never say "SMS" — say "text message" instead.`,
    "",
    `[Delivery & personality] Warm, natural, conversational, lightly enthusiastic — suggestive, never pushy. Keep replies short and ask at most ONE question per turn. Never invent information; stick to what ${company} has told you and what the customer says.`,
  ].join("\n");

  // ── Handlers ──
  const handlers: HandlerSpec[] = [];
  const detector = (key: string, label: string, description: string): HandlerSpec => {
    const h: HandlerSpec = { key, name: snip(label), intent_key: ik(label), description, response_template: "", action_type: "ignore", delivery: "verbatim", mode: "listener", detector: true };
    handlers.push(h);
    return h;
  };
  const line = (key: string, label: string, description: string, text: string, action: HandlerSpec["action_type"] = "answer"): HandlerSpec => {
    const h: HandlerSpec = { key, name: snip(label), intent_key: ik(label), description, response_template: fill(text), action_type: action, delivery: "reword", mode: "both", detector: false };
    handlers.push(h);
    return h;
  };

  const dFollowUp = detector("d:follow_up", "Customer asks a follow-up question", "Customer asks a follow-up question, raises a concern, or asks for clarification about anything that was mentioned");
  const dWrapUp = detector("d:wrap_up", "Customer is wrapping up the call", "Customer is wrapping up the call — thanks, ok, sure, sounds good, bye");
  const dDecline = detector("d:decline", "Customer declines or wants no more contact", "Customer says they don't want the text message, doesn't want to be contacted, or isn't interested at all");
  const dObjections = f.objections.map((o, i) => detector(`d:obj${i}`, o.name, `Customer says something like: ${o.trigger}`));

  // Playbook members: answers the agent can draw on at any point.
  const members: HandlerSpec[] = [
    line("l:who", "Who are you?", "Customer asks who is calling or where you are calling from", `I'm ${agent.name}, calling on behalf of ${company} — ${agent.role.toLowerCase()} team.`),
    line("l:number", "How did you get my number?", "Customer asks how you got their number", `Your details are on the account you have with ${company}. If you'd rather we didn't call, just say so and I'll make sure of it.`),
    line("l:robot", "Are you a real person?", "Customer asks whether they are speaking to a person or an automated system", `I'm an automated assistant working for ${company}, and I can pass anything on to the team if you'd rather speak to a person.`),
    line("l:scam", "Is this a scam?", "Customer is suspicious or asks whether this is legitimate", "Completely fair to ask. I won't ask for passwords, card numbers or any payment details on this call, and everything I mention will also come to you in writing."),
    line("l:later", "Call me later", "Customer asks you to call back at another time", "Of course. When would suit you better? I'll make a note and someone will get back to you then."),
    line("l:positive", f.positive.name, `Customer says something like: ${f.positive.trigger}`, f.positive.reply),
    ...f.objections.map((o, i) => line(`l:obj${i}`, o.name, `Customer says something like: ${o.trigger}`, o.reply)),
  ];
  const goodbyeA = line("l:goodbye", "Goodbye", "The call is complete", f.goodbye, "end_call");
  const goodbyeB = line("l:goodbye_declined", "Goodbye after a decline", "The customer declined; end politely", "No problem at all. Thanks for your time — take care.", "end_call");

  // ── Nodes ──
  const nodes: NodeSpec[] = [];
  const edges: EdgeSpec[] = [];
  const conn = (c: Omit<Connector, "id">): Connector => ({ id: "c:" + uuid(), ...c });
  const node = (label: string, cfg: Record<string, unknown>, x: number, y: number, extra: Partial<NodeSpec> = {}): NodeSpec => {
    const n: NodeSpec = { id: uuid(), type: "step", label, config: cfg, pos_x: x, pos_y: y, ...extra };
    nodes.push(n);
    return n;
  };
  const link = (from: NodeSpec, c: Connector, to: NodeSpec) => {
    edges.push({
      id: uuid(),
      source_node_id: from.id,
      target_node_id: to.id,
      condition: c.any ? { kind: "any", handle: c.id } : { by: "intent", kind: "intent", value: c.intentKey, handle: c.id },
      label: snip(c.label, 20),
    });
  };
  const anyC = () => conn({ any: true, label: "anything else", intentKey: "" });
  const intentC = (d: HandlerSpec, quickWords?: string) => conn({ intentKey: d.intent_key, label: d.name, ...(quickWords ? { quickWords } : {}) });
  const WRAP_QUICK = "ok, okay, thank you, thanks, sure, yeah, yep, alright, bye, thx";
  const COLLECTION = "__collection__"; // placeholder replaced at install

  // Start
  const cStart = anyC();
  const start = node("Start call - Opener", { mode: "agent_first", opening: fill(f.opening), openingDelivery: "verbatim", connectors: [cStart] }, 80, -80, { type: "start" });

  // Call Goal (floating)
  node("Call Goal", {
    contentType: "call_goal",
    statements: [...f.goals.map(fill), ...(f.sms ? ["You're sending a text message with all the details."] : []), "Wish them well and say goodbye."],
  }, 760, 40);

  // Pitch
  const cPitch = anyC();
  const pitch = node("The reason for the call", {
    contentType: "collection", collectionId: COLLECTION, connectors: [cPitch],
    statements: [
      `So {{playerName}}, the reason I'm calling is: ${fill(f.value)}`,
      "Hint that there's a bit more to it than that and get them to react in your own way. Don't end on a dead beat.",
    ],
  }, 96, 96);

  // Details + text message
  const cDetFollow = intentC(dFollowUp);
  const cDetWrap = intentC(dWrapUp, WRAP_QUICK);
  const cDetDecline = intentC(dDecline);
  const cDetObj = dObjections.map((d) => intentC(d));
  const details = node(f.sms ? "The details + text message" : "The details", {
    contentType: "collection", collectionId: COLLECTION, connectors: [cDetFollow, cDetWrap, cDetDecline, ...cDetObj],
    statements: [
      `If they're open to it: ${fill(f.positive.reply)}`,
      ...(f.sms ? ["Let them know you'll send everything over by text message so they've got the details in one place, and ask if this is still the best number for them. Never read a phone number or email address out loud."] : []),
      "Remind them of the next step and why it's worth doing today — lightly, without pressure. Don't end on a dead beat.",
    ],
  }, 96, 336);

  // Follow-up chain (four boxes, like the reference script)
  const followUp = (label: string, statement: string, x: number, y: number) => {
    const cs = { follow: intentC(dFollowUp), wrap: intentC(dWrapUp, WRAP_QUICK), decline: intentC(dDecline) };
    const n = node(label, { contentType: "collection", collectionId: COLLECTION, connectors: [cs.follow, cs.wrap, cs.decline], statements: [statement] }, x, y);
    return { n, cs };
  };
  const f1 = followUp("If customer has follow up questions", "If you've just answered a question, ask if that answers it — and don't end on a dead beat.", -400, 480);
  const f2 = followUp("Anything else?", "Ask if there's anything else they'd like to ask you.", -448, 800);
  const f3 = followUp("Push the next step", `Gently push the next step once more: ${fill((f.goals[1] ?? f.goals[0]).toLowerCase())}. Say you appreciate their time.`, -448, 1008);
  const cF4Any = anyC();
  const cF4Decline = intentC(dDecline);
  const f4 = node("Last word", { contentType: "collection", collectionId: COLLECTION, connectors: [cF4Any, cF4Decline], statements: ["Wrap up warmly — thank them, confirm what happens next, and wish them a good day."] }, -464, 1216);

  // Decline route
  const cDecAny = anyC();
  const decline = node("Decline route", { contentType: "collection", collectionId: COLLECTION, connectors: [cDecAny], statements: ["Fair enough — reassure them they won't receive any further calls or messages about this, and thank them for their time."] }, 640, 608);

  // Objection boxes
  const objectionNodes = f.objections.map((o, i) => {
    const c = anyC();
    return { o, c, n: node(o.name, { contentType: "collection", collectionId: COLLECTION, connectors: [c], statements: [fill(o.reply), "Then ask if that helps, and don't end on a dead beat."] }, 560, 200 + i * 130) };
  });

  // Ends
  const endA = node("End Call", { contentType: "end" }, 96, 800, { scenarioKey: goodbyeA.key });
  const endB = node("End Call", { contentType: "end" }, 256, 1280, { scenarioKey: goodbyeB.key });

  // ── Edges ──
  link(start, cStart, pitch);
  link(pitch, cPitch, details);
  link(details, cDetFollow, f1.n);
  link(details, cDetWrap, endA);
  link(details, cDetDecline, decline);
  cDetObj.forEach((c, i) => link(details, c, objectionNodes[i].n));
  for (const { o, c, n } of objectionNodes) {
    link(n, c, o.next === "goodbye" ? endA : o.next === "value" ? pitch : f1.n);
  }
  link(f1.n, f1.cs.follow, f2.n); link(f1.n, f1.cs.wrap, endA); link(f1.n, f1.cs.decline, endB);
  link(f2.n, f2.cs.follow, f3.n); link(f2.n, f2.cs.wrap, endA); link(f2.n, f2.cs.decline, endB);
  link(f3.n, f3.cs.follow, f4); link(f3.n, f3.cs.wrap, endA); link(f3.n, f3.cs.decline, endB);
  link(f4, cF4Any, endA); link(f4, cF4Decline, endB);
  link(decline, cDecAny, endB);

  return {
    name: scriptName,
    description: fill(agent.tagline),
    persona,
    voiceId: agent.voiceId,
    handlers,
    collection: { name: `${scriptName} — playbook`, description: `Answers ${agent.name} can draw on during the call.`, memberKeys: members.map((m) => m.key) },
    nodes,
    edges,
  };
}

/** Structural check, the same rules the builder's pre-call check enforces. Empty = valid. */
export function validateScriptSpec(spec: ScriptSpec): string[] {
  const problems: string[] = [];
  const byIntent = new Map(spec.handlers.map((h) => [h.intent_key, h]));
  const nodeById = new Map(spec.nodes.map((n) => [n.id, n]));
  for (const n of spec.nodes) {
    const connectors = ((n.config.connectors as Connector[] | undefined) ?? []);
    for (const c of connectors) {
      if (!c.any && !byIntent.has(c.intentKey)) problems.push(`${n.label}: connector "${c.label}" has no reply detector`);
      if (!spec.edges.some((e) => e.source_node_id === n.id && e.condition.handle === c.id)) problems.push(`${n.label}: connector "${c.label}" has no arrow`);
    }
    if (n.config.contentType === "end" && !n.scenarioKey) problems.push(`${n.label}: end box has no goodbye`);
  }
  for (const e of spec.edges) {
    const src = nodeById.get(e.source_node_id);
    if (!src || !nodeById.has(e.target_node_id)) problems.push("edge with unknown node");
    else if (!((src.config.connectors as Connector[] | undefined) ?? []).some((c) => c.id === e.condition.handle)) problems.push(`${src.label}: edge uses an unknown connector`);
  }
  // Reachability from Start (Call Goal floats by design).
  const start = spec.nodes.find((n) => n.type === "start");
  if (!start) problems.push("no Start box");
  else {
    const seen = new Set<string>([start.id]);
    const q = [start.id];
    while (q.length) { const id = q.shift()!; for (const e of spec.edges) if (e.source_node_id === id && !seen.has(e.target_node_id)) { seen.add(e.target_node_id); q.push(e.target_node_id); } }
    for (const n of spec.nodes) if (!seen.has(n.id) && n.config.contentType !== "call_goal") problems.push(`${n.label} is unreachable`);
  }
  const text = JSON.stringify(spec);
  if (/\{\{\s*(company|brand|first_name)\s*\}\}/.test(text)) problems.push("unfilled placeholder");
  return problems;
}
