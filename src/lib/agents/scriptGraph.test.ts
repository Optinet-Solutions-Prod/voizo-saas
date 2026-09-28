import { describe, expect, it } from "vitest";
import { AGENT_CATALOG } from "./catalog";
import { buildAgentScript, validateScriptSpec } from "./scriptGraph";

const counter = () => { let n = 0; return () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`; };

describe("buildAgentScript", () => {
  it("produces a structurally valid script for every agent", () => {
    for (const a of AGENT_CATALOG) {
      const spec = buildAgentScript(a, { company: "Acme", suffix: "t1", uuid: counter() });
      expect(validateScriptSpec(spec), a.key).toEqual([]);
      // production layout: start, pitch, details, four follow-ups, decline, goal, two ends, plus objections
      expect(spec.nodes.length).toBe(11 + a.flow.objections.length);
      expect(spec.nodes.filter((n) => n.config.contentType === "end")).toHaveLength(2);
      expect(spec.nodes.find((n) => n.type === "start")?.config.opening).toContain("Acme");
    }
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
    expect(spec.handlers.filter((h) => h.action_type === "end_call")).toHaveLength(2);
    // intent keys carry the install suffix so two installs never collide
    expect(spec.handlers.every((h) => h.intent_key.endsWith("_t3"))).toBe(true);
  });
});
