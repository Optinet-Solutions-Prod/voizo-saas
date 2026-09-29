import { describe, expect, it } from "vitest";
import { heuristicMatch, parseMatches } from "./match";

describe("heuristicMatch", () => {
  it("finds industry-specific agents", () => {
    expect(heuristicMatch("dental clinic").map((m) => m.key)).toContain("appointment-reminder");
    expect(heuristicMatch("real estate agency selling flats").map((m) => m.key)).toContain("real-estate-qualifier");
    expect(heuristicMatch("restaurant and hotel").map((m) => m.key)).toContain("reservation-confirmation");
  });
  it("always returns three", () => {
    expect(heuristicMatch("zzzz qqqq")).toHaveLength(3);
  });
});

describe("parseMatches", () => {
  it("keeps valid keys in order and fills gaps", () => {
    const out = parseMatches('{"matches":[{"key":"win-back","reason":"Bring lapsed members back."},{"key":"nope"}]}', "gym", "Pulse");
    expect(out[0]).toMatchObject({ key: "win-back", reason: "Bring lapsed members back." });
    expect(out).toHaveLength(3);
    expect(new Set(out.map((m) => m.key)).size).toBe(3);
  });
  it("survives garbage", () => {
    expect(parseMatches("not json", "bakery", "")).toHaveLength(3);
  });
});
