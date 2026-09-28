import { randomUUID } from "node:crypto";
import type { AgentTemplate } from "./catalog";
import { buildAgentScript, validateScriptSpec } from "./scriptGraph";
import { createCollection, createHandler, createScript, saveScriptGraph, setCollectionHandlers, updateScript } from "../scriptEngine/lab-db";

// Installs a pre-built agent as a real Script Builder script for the calling organization,
// persisting the spec from scriptGraph.ts exactly the way the builder does by hand:
// reply detectors + playbook lines as handlers, a playbook collection, the script, then the
// graph. Runs on the tenant-aware client, so every row lands in the caller's organization.

export interface InstallResult {
  scriptId: string;
  scriptName: string;
  handlerCount: number;
}

export async function installAgentTemplate(agent: AgentTemplate, opts: { company?: string } = {}): Promise<InstallResult> {
  const spec = buildAgentScript(agent, { company: opts.company ?? "", suffix: randomUUID().slice(0, 6), uuid: randomUUID });
  const problems = validateScriptSpec(spec);
  if (problems.length) throw new Error(`Template "${agent.key}" is not valid: ${problems.join("; ")}`);

  // 1. Handlers (detectors and lines) — keep the symbolic key → row id map.
  const idOf = new Map<string, string>();
  for (const h of spec.handlers) {
    const row = await createHandler({
      name: h.name,
      intent_key: h.intent_key,
      description: h.description,
      response_template: h.response_template,
      action_type: h.action_type,
      delivery: h.delivery,
      mode: h.mode,
      priority: 100,
      enabled: true,
      group_name: spec.name,
      tags: h.detector ? [spec.name, "Reply detector"] : [spec.name, agent.key],
    });
    idOf.set(h.key, row.id);
  }

  // 2. The playbook collection the collection boxes point at.
  const collection = await createCollection(spec.collection.name, spec.collection.description);
  await setCollectionHandlers(collection.id, spec.collection.memberKeys.map((k) => idOf.get(k)!));

  // 3. The script row.
  const script = await createScript(spec.name);
  await updateScript(script.id, { description: spec.description, persona: spec.persona, voice_id: spec.voiceId });

  // 4. The graph, with the collection id and goodbye scenarios resolved.
  const nodes = spec.nodes.map((n) => ({
    id: n.id,
    type: n.type,
    scenario_id: n.scenarioKey ? idOf.get(n.scenarioKey)! : null,
    label: n.label,
    config: { ...n.config, ...(n.config.collectionId === "__collection__" ? { collectionId: collection.id } : {}) },
    pos_x: n.pos_x,
    pos_y: n.pos_y,
  }));
  await saveScriptGraph(script.id, nodes, spec.edges);

  return { scriptId: script.id, scriptName: script.name, handlerCount: spec.handlers.length };
}
