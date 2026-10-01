import { describe, it, expect, beforeEach, vi } from "vitest";

// Greet-by-name Ramp 4 / identity check (2026-10-01). The entry stage is baked
// token-stripped into the shared clone; this module pushes it again with the
// call's variables when the call connects. Collaborators are mocked so the
// suite pins the module's OWN gating and rendering: the flow state, settings,
// graph and compiled briefing are controlled inputs; lab-flow (findEntryNode)
// and resolveScript run for real.

const m = vi.hoisted(() => ({
  flowState: null as Record<string, unknown> | null,
  settings: null as Record<string, unknown> | null,
  briefing: null as string | null,
  controlUrl: "https://control.example/call-1" as string | null,
  injectOk: true,
  injected: [] as { url: string; text: string; trigger: boolean }[],
  events: [] as Record<string, unknown>[],
}));

vi.mock("./lab-db", () => ({
  getFlowState: vi.fn(async () => m.flowState),
  getLabSettings: vi.fn(async () => m.settings),
  getScriptGraph: vi.fn(async () => ({
    nodes: [
      { id: "start", type: "start", label: "Start call - Opener", config: { opening: "Hi, this is Ava from Acme." } },
      { id: "identity", type: "step", label: "Identity check", config: { contentType: "collection" } },
    ],
    edges: [{ id: "e1", source_node_id: "start", target_node_id: "identity", condition: { kind: "any" } }],
  })),
  listHandlers: vi.fn(async () => []),
  insertLabEvent: vi.fn(async (e: Record<string, unknown>) => { m.events.push(e); }),
}));

vi.mock("./lab-briefing", () => ({
  composeArmedBriefing: vi.fn(async () => (m.briefing ? { text: m.briefing, covered: 0, owed: 0, missing: 0 } : null)),
}));

vi.mock("./lab-control", () => ({
  getControlUrl: vi.fn(async () => m.controlUrl),
  injectStaffNote: vi.fn(async (url: string, text: string, trigger: boolean) => {
    m.injected.push({ url, text, trigger });
    return { ok: m.injectOk, status: m.injectOk ? 200 : 500 };
  }),
}));

import { armEntryStageWithVariables, hasRenderableVariables } from "./entryStage";

const STAGE =
  '[CURRENT STAGE — "Start call - Opener"]\n• For ANY other reply →\n  Then ALWAYS continue in the SAME reply with: "Just to check, {{#playerName}}am I speaking with {{playerName}}{{else}}who am I speaking with{{/playerName}}?"';

beforeEach(() => {
  m.flowState = { call_id: "call-1", script_id: "s1", current_node_id: null, variables: { playerName: "Chris" } };
  m.settings = { active_script_id: null };
  m.briefing = STAGE;
  m.controlUrl = "https://control.example/call-1";
  m.injectOk = true;
  m.injected = [];
  m.events = [];
});

describe("hasRenderableVariables", () => {
  it("needs at least one non-blank author variable, ignoring engine bookkeeping", () => {
    expect(hasRenderableVariables({ playerName: "Chris" })).toBe(true);
    expect(hasRenderableVariables({ playerName: "  " })).toBe(false);
    expect(hasRenderableVariables({ __stack: [], __lastResult: "x" })).toBe(false);
    expect(hasRenderableVariables(null)).toBe(false);
    expect(hasRenderableVariables([])).toBe(false);
  });
});

describe("armEntryStageWithVariables", () => {
  it("pushes the entry stage rendered with the real name as a silent staff note", async () => {
    expect(await armEntryStageWithVariables("call-1", "hint")).toBe("pushed");
    expect(m.injected).toHaveLength(1);
    expect(m.injected[0].trigger).toBe(false);
    expect(m.injected[0].text).toContain("Just to check, am I speaking with Chris?");
    expect(m.injected[0].text).not.toContain("{{");
    expect(m.events).toHaveLength(1);
    expect(m.events[0].event_type).toBe("injected");
    expect((m.events[0].meta as Record<string, unknown>).mode).toBe("briefed");
    expect((m.events[0].meta as Record<string, unknown>).toNode).toBe("start");
  });

  it("does nothing for a call with no flow state (not a script call)", async () => {
    m.flowState = null;
    expect(await armEntryStageWithVariables("call-1", null)).toBe("no_flow_state");
    expect(m.injected).toHaveLength(0);
  });

  it("does nothing once the flow has moved past Start (later stages render live anyway)", async () => {
    m.flowState = { ...m.flowState!, current_node_id: "identity" };
    expect(await armEntryStageWithVariables("call-1", null)).toBe("flow_already_moved");
    expect(m.injected).toHaveLength(0);
  });

  it("does nothing without variables — the prompt's token-stripped copy already reads right", async () => {
    m.flowState = { ...m.flowState!, variables: {} };
    expect(await armEntryStageWithVariables("call-1", null)).toBe("no_variables");
    m.flowState = { ...m.flowState!, variables: null };
    expect(await armEntryStageWithVariables("call-1", null)).toBe("no_variables");
    expect(m.injected).toHaveLength(0);
  });

  it("does nothing when the entry stage has no tokens to render", async () => {
    m.briefing = "[CURRENT STAGE]\n• For ANY other reply → say the reason for the call.";
    expect(await armEntryStageWithVariables("call-1", null)).toBe("no_tokens");
    expect(m.injected).toHaveLength(0);
    expect(m.events).toHaveLength(0);
  });

  it("falls back to the global active script for an unseeded (Builder test) call", async () => {
    m.flowState = { ...m.flowState!, script_id: null };
    m.settings = { active_script_id: "s-global" };
    expect(await armEntryStageWithVariables("call-1", null)).toBe("pushed");
    m.settings = null;
    expect(await armEntryStageWithVariables("call-1", null)).toBe("no_script");
  });

  it("reports a missing control URL and a refused push without throwing", async () => {
    m.controlUrl = null;
    expect(await armEntryStageWithVariables("call-1", null)).toBe("no_control_url");
    m.controlUrl = "https://control.example/call-1";
    m.injectOk = false;
    expect(await armEntryStageWithVariables("call-1", null)).toBe("push_failed");
    expect((m.events[0].meta as Record<string, unknown>).controlOk).toBe(false);
  });
});
