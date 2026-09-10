import { describe, it, expect } from "vitest";
import { loadDeposits, loadReachWindow, mapReachWindow, mapRollup } from "./audienceDeposits";

// The mapper is the one piece of logic between the database function and the strip. The
// arithmetic lives in SQL and is proved by scripts/_gate-0910-deposit-rollup.cjs against the two
// older functions; this pins the mapping: grains land in the right place, strings from PostgREST
// become numbers, orders match what the strip rendered before, and unknown input is ignored.
describe("mapRollup", () => {
  it("routes the three grains to days, totals and the distinct depositor count", () => {
    const out = mapRollup([
      { grain: "currency", day: null, currency: "AUD", deposits: 3, players: 2, amount_local: "150.5", amount_eur: "93.2", deposits_before: 1 },
      { grain: "day", day: "2026-09-04", currency: null, deposits: 2, players: 2, amount_local: null, amount_eur: "60", deposits_before: 0 },
      { grain: "total", day: null, currency: null, deposits: 3, players: 2, amount_local: "150.5", amount_eur: "93.2", deposits_before: 1 },
      { grain: "day", day: "2026-09-03", currency: null, deposits: 1, players: 1, amount_local: null, amount_eur: "33.2", deposits_before: 1 },
    ]);
    expect(out.depositors).toBe(2);
    expect(out.days.map((d) => d.day)).toEqual(["2026-09-03", "2026-09-04"]); // ascending, like audience_lane_deposits
    expect(out.days[1]).toEqual({ day: "2026-09-04", deposits: 2, players: 2, amountEur: 60, depositsBefore: 0 });
    expect(out.totals).toEqual([{ currency: "AUD", deposits: 3, players: 2, amountLocal: 150.5, amountEur: 93.2, before: 1 }]);
  });

  it("orders currencies by EUR descending, as the strip always showed them", () => {
    const out = mapRollup([
      { grain: "currency", day: null, currency: "NZD", deposits: 1, players: 1, amount_local: "100", amount_eur: "50", deposits_before: 0 },
      { grain: "currency", day: null, currency: "AUD", deposits: 1, players: 1, amount_local: "100", amount_eur: "61", deposits_before: 0 },
    ]);
    expect(out.totals.map((t) => t.currency)).toEqual(["AUD", "NZD"]);
  });

  it("KNOWN-BAD: a depositor count is never SUMMED across currencies", () => {
    // One player deposited in two currencies. The per-currency players add to 2; the total grain
    // says 1. The strip must read the total grain, or the same player counts twice.
    const out = mapRollup([
      { grain: "currency", day: null, currency: "AUD", deposits: 1, players: 1, amount_local: "10", amount_eur: "6", deposits_before: 0 },
      { grain: "currency", day: null, currency: "NZD", deposits: 1, players: 1, amount_local: "10", amount_eur: "5", deposits_before: 0 },
      { grain: "total", day: null, currency: null, deposits: 2, players: 1, amount_local: "20", amount_eur: "11", deposits_before: 0 },
    ]);
    expect(out.depositors).toBe(1);
    expect(out.totals.reduce((a, t) => a + t.players, 0)).toBe(2); // and that sum is NOT what the strip shows
  });

  it("fails SAFE on nothing: an empty result is an empty strip with zero depositors, not a crash", () => {
    expect(mapRollup([])).toEqual({ days: [], totals: [], depositors: 0 });
  });

  it("ignores a grain it does not know and a day row with no day", () => {
    const out = mapRollup([
      { grain: "week" as never, day: "2026-09-01", currency: null, deposits: 9, players: 9, amount_local: null, amount_eur: "9", deposits_before: 0 },
      { grain: "day", day: null, currency: null, deposits: 9, players: 9, amount_local: null, amount_eur: "9", deposits_before: 0 },
    ]);
    expect(out).toEqual({ days: [], totals: [], depositors: 0 });
  });
});

// The one branch in loadDeposits: a statement timeout is retried once, anything else is not.
// The page fetches the strip beside the reach route and the players list; alone the all-time call
// takes ~1.3 s, together it once crossed the 8 s limit (2026-09-10). Pinned so the retry cannot
// quietly widen into "retry everything" or vanish.
function fakeSupabase(rpcAnswers: Array<{ data?: unknown; error?: { message: string } | null }>) {
  const calls: string[] = [];
  const client = {
    rpc: async (name: string) => { calls.push(name); return rpcAnswers.shift() ?? { data: [], error: null }; },
    // depositCoverage: three small selects; all resolve empty.
    from: () => {
      const b: Record<string, unknown> = {};
      for (const m of ["select", "eq", "filter", "order"]) b[m] = () => b;
      b.limit = async () => ({ data: [], error: null });
      return b;
    },
  };
  return { client: client as never, calls };
}
const F = { deposited: "any", contact: "any", familyIds: null, q: null };

describe("loadDeposits — retries a statement timeout ONCE and nothing else", () => {
  it("a timeout then an answer → the answer, two rpc calls", async () => {
    const { client, calls } = fakeSupabase([
      { data: null, error: { message: "canceling statement due to statement timeout" } },
      { data: [{ grain: "total", day: null, currency: null, deposits: 1, players: 1, amount_local: "5", amount_eur: "3", deposits_before: 0 }], error: null },
    ]);
    const out = await loadDeposits(client, ["c1"], "2026-09-03T00:00:00Z", "2026-09-10T00:00:00Z", F);
    expect(out.depositors).toBe(1);
    expect(calls.filter((c) => c === "audience_lane_deposit_rollup")).toHaveLength(2);
  }, 10_000);

  it("two timeouts → the error surfaces, no third try", async () => {
    const { client, calls } = fakeSupabase([
      { data: null, error: { message: "statement timeout" } },
      { data: null, error: { message: "statement timeout" } },
    ]);
    await expect(loadDeposits(client, ["c1"], "2026-09-03T00:00:00Z", "2026-09-10T00:00:00Z", F)).rejects.toThrow(/statement timeout/);
    expect(calls.filter((c) => c === "audience_lane_deposit_rollup")).toHaveLength(2);
  }, 10_000);

  it("KNOWN-BAD: a missing function is NOT retried, it surfaces at once", async () => {
    const { client, calls } = fakeSupabase([
      { data: null, error: { message: "Could not find the function public.audience_lane_deposit_rollup" } },
    ]);
    await expect(loadDeposits(client, ["c1"], "2026-09-03T00:00:00Z", "2026-09-10T00:00:00Z", F)).rejects.toThrow(/Could not find/);
    expect(calls.filter((c) => c === "audience_lane_deposit_rollup")).toHaveLength(1);
  });
});

// ── The merged Reach card (2026-09-11) ──
// Same division of labour as the strip: the arithmetic is SQL's and is proved against
// audience_lane_reach by scripts/_gate-0911-reach-window.cjs. This pins the mapping, the numeric
// coercion PostgREST forces on a numeric column, and the empty case.
describe("mapReachWindow", () => {
  const row = {
    contacted: 674, dialled: 666, answered: 297, spoke: 35, texted: 27, text_delivered: 26,
    texted_not_answered: 17, msgs: 27, msgs_delivered: 26, msgs_failed: 1, msgs_unconfirmed: 0,
    emailed: 18, depositors: 10, deposits: 12, amount_eur: "422.5242531149",
  };

  it("maps every column and turns the numeric EUR string into a number", () => {
    const out = mapReachWindow([row])!;
    expect(out.contacted).toBe(674);
    expect(out.textDelivered).toBe(26);
    expect(out.textedNotAnswered).toBe(17);
    expect(out.msgsUnconfirmed).toBe(0);
    expect(out.emailed).toBe(18);
    expect(out.amountEur).toBeCloseTo(422.5242531149, 6);
  });

  it("fails SAFE on nothing: no row is null, never a card full of zeros", () => {
    // A zero card states "nobody was contacted"; a missing answer states nothing. The page shows
    // "Not available yet" for null, so the two must not collapse into each other.
    expect(mapReachWindow([])).toBeNull();
  });

  it("KNOWN-BAD: a null EUR becomes 0, not NaN", () => {
    const out = mapReachWindow([{ ...row, amount_eur: null }])!;
    expect(out.amountEur).toBe(0);
  });
});

describe("loadReachWindow — the same retry-once rule as the strip", () => {
  it("a timeout then an answer → the answer, two rpc calls", async () => {
    const { client, calls } = fakeSupabase([
      { data: null, error: { message: "canceling statement due to statement timeout" } },
      { data: [{ contacted: 5, dialled: 5, answered: 2, spoke: 1, texted: 0, text_delivered: 0, texted_not_answered: 0, msgs: 0, msgs_delivered: 0, msgs_failed: 0, msgs_unconfirmed: 0, emailed: 0, depositors: 0, deposits: 0, amount_eur: "0" }], error: null },
    ]);
    const out = await loadReachWindow(client, ["c1"], "2026-09-03T00:00:00Z", "2026-09-10T00:00:00Z", F);
    expect(out?.contacted).toBe(5);
    expect(calls.filter((c) => c === "audience_lane_reach_window")).toHaveLength(2);
  }, 10_000);

  it("KNOWN-BAD: a missing function is NOT retried, it surfaces at once", async () => {
    const { client, calls } = fakeSupabase([
      { data: null, error: { message: "Could not find the function public.audience_lane_reach_window" } },
    ]);
    await expect(loadReachWindow(client, ["c1"], "2026-09-03T00:00:00Z", "2026-09-10T00:00:00Z", F)).rejects.toThrow(/Could not find/);
    expect(calls.filter((c) => c === "audience_lane_reach_window")).toHaveLength(1);
  });
});
