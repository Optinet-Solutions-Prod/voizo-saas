// Greet-by-name Ramp 4 — identity check (Chris, 2026-10-01): push the entry
// stage again, rendered with the call's variables, the moment the call connects.
//
// The entry [CURRENT STAGE] ships inside the shared clone's prompt with every
// token stripped (composeAssistant.ts), because one assistant serves every
// contact in a campaign and no per-call value exists at clone time. The model
// answers the customer's FIRST reply natively from that prompt copy — so a
// first-turn line such as "Just to check, am I speaking with {{playerName}}?"
// would be spoken without the name (or, via its {{else}} branch, as "who am I
// speaking with?"). The script-call route seeds lab_call_flow_state.variables
// before the engine sees the call's first status-update, so on "in-progress"
// we compile the same entry stage again, render it with those variables and
// whisper it as a non-triggering [STAFF] note: the newest CURRENT STAGE
// governs (SCRIPT_RULES #8), and it now carries the real name.
//
// Best effort and behaviour-neutral whenever nothing would change: no flow
// state (not a script call), no renderable variables, a flow that has already
// moved past Start, a stage with no tokens, or no control URL.
import { getFlowState, getLabSettings, getScriptGraph, insertLabEvent, listHandlers } from "./lab-db";
import { composeArmedBriefing } from "./lab-briefing";
import { findEntryNode } from "./lab-flow";
import { resolveCallScriptId } from "./resolveScript";
import { substituteVars } from "./substituteVars";
import { getControlUrl, injectStaffNote } from "./lab-control";

/** True when at least one author-facing variable (not the engine's __stack /
 *  __lastResult bookkeeping) holds a non-blank string. */
export function hasRenderableVariables(vars: unknown): vars is Record<string, unknown> {
  if (!vars || typeof vars !== "object" || Array.isArray(vars)) return false;
  return Object.entries(vars as Record<string, unknown>).some(
    ([k, v]) => !k.startsWith("__") && typeof v === "string" && v.trim() !== "",
  );
}

export type EntryStageOutcome =
  | "pushed"
  | "no_flow_state"
  | "flow_already_moved"
  | "no_variables"
  | "no_script"
  | "no_entry"
  | "no_tokens"
  | "no_control_url"
  | "push_failed"
  | "error";

export async function armEntryStageWithVariables(
  callId: string,
  controlUrlHint: string | null,
): Promise<EntryStageOutcome> {
  try {
    const [flowState, settings] = await Promise.all([
      getFlowState(callId).catch(() => null),
      getLabSettings().catch(() => null),
    ]);
    if (!flowState) return "no_flow_state";
    // Later stages render live at every push (handleWebhook / lab-watchdog);
    // only the never-pushed entry stage needs this.
    if (flowState.current_node_id) return "flow_already_moved";
    const variables = flowState.variables;
    if (!hasRenderableVariables(variables)) return "no_variables";
    const scriptId = resolveCallScriptId(flowState, settings);
    if (!scriptId) return "no_script";

    const graph = await getScriptGraph(scriptId);
    const entry = findEntryNode(graph.nodes, graph.edges);
    if (!entry) return "no_entry";
    const armed = await composeArmedBriefing(callId, graph, entry.id, await listHandlers());
    // Token-free stage: the prompt's copy is already exact — pushing it again
    // would only add noise to the context.
    if (!armed || !armed.text.includes("{{")) return "no_tokens";

    const controlUrl = await getControlUrl(callId, controlUrlHint);
    if (!controlUrl) return "no_control_url";
    const r = await injectStaffNote(controlUrl, substituteVars(armed.text, variables), false);
    await insertLabEvent({
      call_id: callId,
      event_type: "injected",
      content: `→ armed stage: ${entry.label || "start"} (opening stage rendered with the call's variables)`,
      meta: {
        flow: true,
        mode: "briefed", // the delivery watchdog ignores briefed rows, as for every armed stage
        toNode: entry.id,
        nodeType: "start",
        entryRender: true,
        controlOk: r.ok,
        controlStatus: r.status,
      },
    }).catch(() => {});
    return r.ok ? "pushed" : "push_failed";
  } catch {
    return "error"; // the prompt's own entry stage still applies
  }
}
