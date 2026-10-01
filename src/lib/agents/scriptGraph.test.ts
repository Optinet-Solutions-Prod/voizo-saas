import { describe, expect, it } from "vitest";
import { AGENT_CATALOG } from "./catalog";
import { IDENTITY_CHECK_LINE, buildAgentScript, validateScriptSpec } from "./scriptGraph";

const counter = () => { let n = 0; return () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`; };

describe("buildAgentScript", () => {
  it("produces a structurally valid script for every agent", () => {
    for (const a of AGENT_CATALOG) {
      const spec = buildAgentScript(a, { company: "Acme", suffix: "t1", uuid: counter() });
      expect(validateScriptSpec(spec), a.key).toEqual([]);
      // production layout: start, identity check, pitch, details, four follow-ups, decline, goal, three ends, plus objections
      expect(spec.nodes.length).toBe(13 + a.flow.objections.length);
      expect(spec.nodes.filter((n) => n.config.contentType === "end")).toHaveLength(3);
      const opening = spec.nodes.find((n) => n.type === "start")?.config.opening as string;
      expect(opening).toContain("Acme");
      // the greeting never carries the name — it is baked into the shared assistant where no name exists yet
      expect(opening).not.toMatch(/\{\{|speaking with|is this/i);
    }
  });

  it("asks for the customer by name right after the greeting, then goes to the pitch or ends", () => {
    const spec = buildAgentScript(AGENT_CATALOG[0], { company: "Acme", suffix: "t4", uuid: counter() });
    const start = spec.nodes.find((n) => n.type === "start")!;
    const identity = spec.nodes.find((n) => n.label === "Identity check")!;
    const pitch = spec.nodes.find((n) => n.label === "The reason for the call")!;
    const wrongEnd = spec.nodes.find((n) => n.label === "End Call - wrong person")!;
    expect(identity.config.statements).toEqual([IDENTITY_CHECK_LINE]);
    expect(IDENTITY_CHECK_LINE).toContain("{{#playerName}}am I speaking with {{playerName}}{{else}}who am I speaking with{{/playerName}}");
    // where the arrow from a given connector (by label, or the "anything else" one) leads
    const to = (from: typeof start, label: string | null) => {
      const cs = from.config.connectors as { id: string; label: string; any?: boolean }[];
      const c = label ? cs.find((x) => x.label === label)! : cs.find((x) => x.any)!;
      return spec.edges.filter((e) => e.source_node_id === from.id && e.condition.handle === c.id).map((e) => e.target_node_id);
    };
    expect(to(start, null)).toEqual([identity.id]);
    expect(to(identity, "Confirms it's them")).toEqual([pitch.id]);
    expect(to(identity, "Wrong person or not available")).toEqual([wrongEnd.id]);
    expect(to(identity, null)).toEqual([pitch.id]);
    const wrongGoodbye = spec.handlers.find((h) => h.key === wrongEnd.scenarioKey)!;
    expect(wrongGoodbye.action_type).toBe("end_call");
    expect(wrongGoodbye.response_template).toMatch(/mix-up/);
    // the "yes / speaking" reply resolves on quick words, no router round-trip
    const yes = (identity.config.connectors as { label: string; quickWords?: string }[]).find((c) => c.label === "Confirms it's them")!;
    expect(yes.quickWords).toContain("speaking");
  });

  it("keeps the customer's name as the engine variable and fills the company", () => {
    const spec = buildAgentScript(AGENT_CATALOG[0], { company: "Riverside Dental", suffix: "t2", uuid: counter() });
    const pitch = spec.nodes.find((n) => n.label === "The reason for the call")!;
    expect((pitch.config.statements as string[])[0]).toMatch(/^So \{\{playerName\}\}, the reason I'm calling is:/);
    expect(JSON.stringify(spec)).not.toContain("{{company}}");
    expect(spec.persona).toContain("[Identity]");
    expect(spec.persona).toContain("[Delivery & personality]");
    expect(spec.persona).toContain("Riverside Dental");
  });

  it("separates reply detectors from playbook lines", () => {
    const spec = buildAgentScript(AGENT_CATALOG[1], { company: "Acme", suffix: "t3", uuid: counter() });
    const detectors = spec.handlers.filter((h) => h.detector);
    expect(detectors.every((h) => h.action_type === "ignore" && h.mode === "listener" && h.response_template === "")).toBe(true);
    expect(spec.collection.memberKeys.some((k) => detectors.some((d) => d.key === k))).toBe(false);
    expect(spec.handlers.filter((h) => h.action_type === "end_call")).toHaveLength(3);
    // intent keys carry the install suffix so two installs never collide
    expect(spec.handlers.every((h) => h.intent_key.endsWith("_t3"))).toBe(true);
  });
});
