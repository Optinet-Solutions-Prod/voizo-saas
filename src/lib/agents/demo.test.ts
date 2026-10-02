import { describe, expect, it } from "vitest";
import { AGENT_CATALOG } from "./catalog";
import { composeDemoAssistant, composeDemoPrompt, demoIdentityQuestion, fillPlaceholders } from "./demo";

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
      // greeting first, then the identity check by name as its own step, then the reason for the call
      expect(prompt).toContain(`1. Opening (you already said it as your first message): "${composeDemoAssistant(a, input).firstMessage}"`);
      expect(prompt).toContain('2. Identity check — as soon as they answer, ask: "Just to check, am I speaking with Chris?"');
      expect(prompt).toContain("3. Reason for the call:");
      const asst = composeDemoAssistant(a, input);
      expect(asst.firstMessage).not.toMatch(/\{\{/);
      expect(asst.firstMessage).not.toMatch(/speaking with|is this/i);
      expect(asst.voice.voiceId).toBe(a.voiceId);
      expect(asst.model.messages[0].content).toBe(prompt);
    }
  });
  it("falls back to neutral words for blank input", () => {
    const asst = composeDemoAssistant(AGENT_CATALOG[0], { company: "  ", firstName: "" });
    expect(asst.firstMessage).toContain("our company");
    expect(asst.model.messages[0].content).toContain('ask: "Just to check, who am I speaking with?"');
    expect(asst.model.messages[0].content).not.toContain("speaking with there");
  });
  it("asks by name when one is given", () => {
    expect(demoIdentityQuestion(" Chris ")).toBe("Just to check, am I speaking with Chris?");
    expect(demoIdentityQuestion("there")).toBe("Just to check, who am I speaking with?");
  });
});

describe("demo framing — agents that sell to businesses", () => {
  it("Leo calls on behalf of the visitor's business", () => {
    const real = AGENT_CATALOG.find((a) => a.key === "lead-qualifier")!;
    expect(real.demo).toBeUndefined();
    expect(composeDemoAssistant(real, { company: "Barvarian", firstName: "Chris", businessType: "barbershop" }).firstMessage).toBe("Hi, this is Leo from Barvarian.");
  });

  // No catalog agent uses this framing today (Leo calls FOR the visitor's business, Chris
  // 2026-10-02); a synthetic copy keeps the mechanism covered.
  const base = AGENT_CATALOG.find((a) => a.key === "lead-qualifier")!;
  const leo = { ...base, demo: { calls: "to" as const, seller: "Brightline", sellerAbout: "a studio that builds websites", product: "a new website for {{business}}", tailor: "You are selling Brightline's website service to them. Never speak as if you work for their business." } };
  const barber = { company: "Barvarian", firstName: "Chris", businessType: "barbershop" };

  it("Leo works for the seller and calls the visitor's business about a website", () => {
    const asst = composeDemoAssistant(leo, barber);
    expect(asst.firstMessage).toBe("Hi, this is Leo from Brightline.");
    const prompt = asst.model.messages[0].content;
    expect(prompt).toContain("You work for Brightline");
    expect(prompt).toContain("Chris from Barvarian (barbershop)");
    expect(prompt).toContain('"You asked about a new website for Barvarian on our website');
    expect(prompt).toMatch(/never speak as if you work for their business/i);
    expect(prompt).not.toContain("our service");
    expect(prompt).not.toMatch(/\{\{|\}\}/);
  });

  it("agents without a framing still call on behalf of the visitor's business", () => {
    const ava = AGENT_CATALOG.find((a) => a.key === "appointment-reminder")!;
    const prompt = composeDemoPrompt(ava, barber);
    expect(composeDemoAssistant(ava, barber).firstMessage).toBe("Hi, this is Ava calling from Barvarian.");
    expect(prompt).toContain("calling on behalf of Barvarian (barbershop)");
    expect(prompt).toContain("instead of a vague \"our service\"");
  });
});

describe("demo calls don't end early", () => {
  it("tells every agent when it may end, and to say what it's sending", () => {
    for (const a of AGENT_CATALOG) {
      const p = composeDemoPrompt(a, input);
      expect(p, a.key).toContain("WHEN TO END THE CALL");
      expect(p).toContain("is never the end of the call");
      expect(p).toContain('"Is there anything else I can help you with?"');
      expect(p).toContain(a.flow.sms ? "a text message with the details" : "an email with the details");
    }
  });
});
