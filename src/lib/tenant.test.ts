import { describe, expect, it } from "vitest";
import { canManageOrg, slugify } from "./tenant";

describe("slugify", () => {
  it("makes URL-safe lowercase slugs", () => {
    expect(slugify("Fortune Play")).toBe("fortune-play");
    expect(slugify("  Lucky7even!! ")).toBe("lucky7even");
    expect(slugify("Café Résumé")).toBe("cafe-resume");
    expect(slugify("---")).toBe("brand");
  });
  it("caps the length", () => {
    expect(slugify("a".repeat(100)).length).toBeLessThanOrEqual(48);
  });
});

describe("canManageOrg", () => {
  it("owners and admins manage, members don't", () => {
    expect(canManageOrg("owner")).toBe(true);
    expect(canManageOrg("admin")).toBe(true);
    expect(canManageOrg("member")).toBe(false);
    expect(canManageOrg(null)).toBe(false);
    expect(canManageOrg(undefined)).toBe(false);
  });
});
