import { randomUUID } from "node:crypto";
import type { AgentTemplate } from "./catalog";
import { createHandler, createScript, saveScriptGraph, updateScript } from "../scriptEngine/lab-db";

// Installs a pre-built agent as a real Script Builder script for the calling organization:
// Playbook scenarios (listener_handlers) for every line, then the script and its graph.
// Runs on the tenant-aware client, so every row lands in the caller's organization.
//
// Graph shape (left → right):
//   Start → Opening → Reason for the call ─┬─ positive reply → SMS (if any) → Goodbye → End
//                                          ├─ objection A → reply → (value | sms | goodbye)
//                                          └─ objection B … ; Call Goal floats beside it.

const COL = 300;
const ROW = 130;

export interface InstallResult {
  scriptId: string;
  scriptName: string;
  handlerCount: number;
}

export async function installAgentTemplate(agent: AgentTemplate, opts: { company?: string } = {}): Promise<InstallResult> {
  const company = opts.company?.trim() || "{{company}}";
  const fill = (s: string) => s.split("{{company}}").join(company);
  const group = `${agent.name} — ${agent.role}`;
  // Intent keys are unique per install so two copies of the same agent never share a scenario.
  const suffix = randomUUID().slice(0, 6);
  const ik = (k: string) => `${k}_${suffix}`;

  const mk = async (name: string, intentKey: string, line: string, action: "answer" | "send_sms" | "end_call", description: string, priority: number) =>
    createHandler({
      name,
      intent_key: ik(intentKey),
      description,
      response_template: fill(line),
      action_type: action,
      delivery: "reword",
      mode: "both",
      enabled: true,
      priority,
      group_name: group,
      tags: [agent.key, ...agent.tags],
    });

  const f = agent.flow;
  const opening = await mk(`${agent.name}: opening`, "opening", f.opening, "answer", "The greeting and identity check.", 100);
  const value = await mk(`${agent.name}: reason for the call`, "reason", f.value, "answer", "Why we are calling and the question we ask.", 90);
  const positive = await mk(`${agent.name}: ${f.positive.name}`, f.positive.intentKey, f.positive.reply, "answer", `Customer says: ${f.positive.trigger}`, 80);
  const objections = [];
  for (const [i, o] of f.objections.entries()) {
    objections.push({ o, h: await mk(`${agent.name}: ${o.name}`, o.intentKey, o.reply, "answer", `Customer says: ${o.trigger}`, 70 - i) });
  }
  const sms = f.sms ? await mk(`${agent.name}: SMS`, "sms", f.sms, "send_sms", "The follow-up text message.", 60) : null;
  const goodbye = await mk(`${agent.name}: goodbye`, "goodbye", f.goodbye, "end_call", "How the call ends.", 50);

  const script = await createScript(`${agent.name} — ${agent.role}`);
  await updateScript(script.id, { description: fill(agent.tagline), persona: fill(agent.persona), voice_id: agent.voiceId });

  type N = { id: string; type: string; scenario_id: string | null; label: string; config: Record<string, unknown>; pos_x: number; pos_y: number };
  type E = { id: string; source_node_id: string; target_node_id: string; condition: Record<string, unknown>; label: string };
  const nodes: N[] = [];
  const edges: E[] = [];
  const node = (label: string, contentType: string | null, scenarioId: string | null, col: number, row: number, extra: Record<string, unknown> = {}): N => {
    const n: N = {
      id: randomUUID(),
      type: contentType ? "step" : "start",
      scenario_id: scenarioId,
      label,
      config: contentType ? { contentType, ...extra } : {},
      pos_x: col * COL,
      pos_y: row * ROW,
    };
    nodes.push(n);
    return n;
  };
  const edge = (from: N, to: N, condition: Record<string, unknown>, label = "") => {
    edges.push({ id: randomUUID(), source_node_id: from.id, target_node_id: to.id, condition, label });
  };

  const start = node("Start call", null, null, 0, 1);
  const nOpening = node("Opening", "scenario", opening.id, 1, 1);
  const nValue = node("Reason for the call", "scenario", value.id, 2, 1);
  const nPositive = node(f.positive.name, "scenario", positive.id, 3, 0);
  const nSms = sms ? node("Send the text", "send_sms", sms.id, 4, 0) : null;
  const nGoodbye = node("Goodbye", "scenario", goodbye.id, 5, 1);
  const nEnd = node("End call", "end", null, 6, 1);
  node("Call goals", "call_goal", null, 2, 3, { statements: f.goals.map(fill) });

  edge(start, nOpening, { kind: "any" });
  edge(nOpening, nValue, { kind: "any" });
  edge(nValue, nPositive, { kind: "intent", value: positive.intent_key }, f.positive.name);
  if (nSms) {
    edge(nPositive, nSms, { kind: "any" });
    edge(nSms, nGoodbye, { kind: "any" });
  } else {
    edge(nPositive, nGoodbye, { kind: "any" });
  }
  objections.forEach(({ o, h }, i) => {
    const n = node(o.name, "scenario", h.id, 3, 1 + i);
    edge(nValue, n, { kind: "intent", value: h.intent_key }, o.name);
    if (o.next === "value") edge(n, nValue, { kind: "any" });
    else if (o.next === "sms" && nSms) edge(n, nSms, { kind: "any" });
    else if (o.next === "positive") edge(n, nPositive, { kind: "any" });
    else edge(n, nGoodbye, { kind: "any" });
  });
  // Silence after the question → wrap up politely.
  edge(nValue, nGoodbye, { kind: "timeout" }, "no reply");
  edge(nGoodbye, nEnd, { kind: "any" });

  await saveScriptGraph(script.id, nodes, edges);
  return { scriptId: script.id, scriptName: script.name, handlerCount: 4 + objections.length + (sms ? 1 : 0) };
}
