import { describe, expect, it } from "vitest";
import { isE164, normalizeE164 } from "./phoneNumbers";

describe("normalizeE164", () => {
  it("strips punctuation and international prefixes", () => {
    expect(normalizeE164("+44 (0)20 3695 3434")).toBe("+442036953434");
    expect(normalizeE164("0044 20-3695-3434")).toBe("+442036953434");
    expect(normalizeE164("+1 647 243 6283")).toBe("+16472436283");
  });
});

describe("isE164", () => {
  it("accepts + and 8–15 digits", () => {
    expect(isE164("+442036953434")).toBe(true);
    expect(isE164("+6498026124")).toBe(true);
  });
  it("rejects local formats and junk", () => {
    expect(isE164("02036953434")).toBe(false);
    expect(isE164("+0123456789")).toBe(false);
    expect(isE164("+12")).toBe(false);
    expect(isE164("+44 20 3695 3434")).toBe(false);
  });
});
