import { describe, expect, it } from "vitest";
import { AGENT_CATALOG } from "./catalog";
import { composeDemoAssistant, composeDemoPrompt, fillPlaceholders } from "./demo";

const input = { company: "Riverside Dental", firstName: "Chris" };

describe("fillPlaceholders", () => {
  it("fills company, name and demo defaults", () => {
    expect(fillPlaceholders("Hi {{first_name}}, this is {{company}} about {{appointment_date}}.", input)).toBe("Hi Chris, this is Riverside Dental about tomorrow.");
  });
  it("never leaves braces behind", () => {
    expect(fillPlaceholders("{{unknown_thing}} and {{ company }}", input)).toBe("the details and Riverside Dental");
  });
});

describe("composeDemoPrompt / composeDemoAssistant", () => {
  it("covers every agent without placeholders", () => {
    for (const a of AGENT_CATALOG) {
      const prompt = composeDemoPrompt(a, input);
      expect(prompt).not.toMatch(/\{\{|\}\}/);
      expect(prompt).toContain("Riverside Dental");
      expect(prompt).toContain("Chris");
      const asst = composeDemoAssistant(a, input);
      expect(asst.firstMessage).not.toMatch(/\{\{/);
      expect(asst.voice.voiceId).toBe(a.voiceId);
      expect(asst.model.messages[0].content).toBe(prompt);
    }
  });
  it("falls back to neutral words for blank input", () => {
    const asst = composeDemoAssistant(AGENT_CATALOG[0], { company: "  ", firstName: "" });
    expect(asst.firstMessage).toContain("our company");
    expect(asst.firstMessage).toContain("there");
  });
});
