import { describe, expect, it } from "vitest";
import { isAdmin, safeNextPath } from "./auth";

describe("isAdmin", () => {
  it("accepts only app_metadata.role === 'admin'", () => {
    expect(isAdmin({ app_metadata: { role: "admin" } })).toBe(true);
    expect(isAdmin({ app_metadata: { role: "viewer" } })).toBe(false);
    expect(isAdmin({ app_metadata: {} })).toBe(false);
    expect(isAdmin(null)).toBe(false);
    expect(isAdmin(undefined)).toBe(false);
  });
});

describe("safeNextPath", () => {
  it("keeps same-origin paths, query included", () => {
    expect(safeNextPath("/campaigns")).toBe("/campaigns");
    expect(safeNextPath("/campaigns/v2/new?step=2")).toBe("/campaigns/v2/new?step=2");
  });

  it("falls back to the dashboard for anything that could leave the site", () => {
    expect(safeNextPath("https://evil.com")).toBe("/dashboard");
    expect(safeNextPath("//evil.com")).toBe("/dashboard");
    expect(safeNextPath("/\\evil.com")).toBe("/dashboard");
    expect(safeNextPath("javascript:alert(1)")).toBe("/dashboard");
  });

  it("falls back to the dashboard when empty or pointing back at /login", () => {
    expect(safeNextPath(null)).toBe("/dashboard");
    expect(safeNextPath("")).toBe("/dashboard");
    expect(safeNextPath("/login")).toBe("/dashboard");
    expect(safeNextPath("/login?next=/x")).toBe("/dashboard");
  });
});
