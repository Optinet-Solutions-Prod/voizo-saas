import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { mobivateOptoutGate } from "./mobivateOptoutGate";

function fakeSupabase(answer: { data: unknown; error: unknown }) {
  const q = { select: () => q, eq: () => q, limit: async () => answer };
  return { from: () => q } as unknown as SupabaseClient;
}

describe("mobivateOptoutGate", () => {
  it("blocks a listed number and says why", async () => {
    expect(await mobivateOptoutGate(fakeSupabase({ data: [{ kind: "dead_number" }], error: null }), "+64211657305"))
      .toEqual({ blocked: true, kind: "dead_number", error: null });
  });
  it("lets an unlisted number through", async () => {
    expect(await mobivateOptoutGate(fakeSupabase({ data: [], error: null }), "+64211657305"))
      .toEqual({ blocked: false, kind: null, error: null });
  });
  it("fails CLOSED on a read error (an irreversible send must not ride on a failed check)", async () => {
    const r = await mobivateOptoutGate(fakeSupabase({ data: null, error: { message: "relation mobivate_optouts does not exist" } }), "+64211657305");
    expect(r.blocked).toBe(true);
    expect(r.error).toMatch(/does not exist/);
  });
});
