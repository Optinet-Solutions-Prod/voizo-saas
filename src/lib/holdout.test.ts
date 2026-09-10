import { describe, it, expect } from "vitest";
import { holdoutKey, isHeldOut, HOLDOUT_OUTCOME } from "./holdout";

// The four properties the measurement depends on. If any one of them breaks the
// arms stop being comparable and every number the holdout produces is worthless,
// so each gets a test rather than a comment.
describe("isHeldOut — the coin", () => {
  it("is STABLE: the same player and campaign always get the same answer", () => {
    // A retry must not re-flip the coin, or a player drifts between arms mid-run.
    const first = isHeldOut("+61400000001", "camp-a", 10);
    for (let i = 0; i < 50; i++) {
      expect(isHeldOut("+61400000001", "camp-a", 10)).toBe(first);
    }
  });

  it("is INERT at 0: nobody is ever held out, which is every campaign today", () => {
    for (let i = 0; i < 2000; i++) {
      expect(isHeldOut(`+6140000${i}`, "camp-a", 0)).toBe(false);
    }
  });

  it("holds everyone out at 100", () => {
    for (let i = 0; i < 500; i++) {
      expect(isHeldOut(`+6140000${i}`, "camp-a", 100)).toBe(true);
    }
  });

  it("treats a missing, negative or oversized pct as 0 — a bad column value must never withhold calls", () => {
    for (const pct of [null, undefined, NaN, -1, -100, 0.4] as unknown as number[]) {
      expect(isHeldOut("+61400000001", "camp-a", pct)).toBe(false);
    }
    // Above 100 clamps to 100 rather than wrapping to a small number.
    expect(isHeldOut("+61400000001", "camp-a", 900)).toBe(true);
  });

  it("splits close to the requested share: 10% over 100,000 ids, the other sizes over 10,000", () => {
    // 100,000 at 10% is the check the design names. The other candidate sizes get
    // a smaller sample with a looser tolerance, because 400,000 sha1 hashes push a
    // single unit test past 6 seconds and this suite runs 1,600+ of them.
    const measure = (pct: number, n: number) => {
      let held = 0;
      for (let i = 0; i < n; i++) if (isHeldOut(`+6141${String(i).padStart(6, "0")}`, "camp-a", pct)) held++;
      return (held / n) * 100;
    };
    expect(Math.abs(measure(10, 100_000) - 10)).toBeLessThan(1);
    for (const pct of [5, 20, 50]) {
      expect(Math.abs(measure(pct, 10_000) - pct)).toBeLessThan(1.5);
    }
  }, 15_000);

  it("assigns INDEPENDENTLY per campaign: the same player can be held out in one and dialled in another", () => {
    // Keeps the arms balanced per campaign instead of banishing the same
    // unlucky players from every campaign at once.
    let differ = 0;
    for (let i = 0; i < 5000; i++) {
      const phone = `+6142${String(i).padStart(6, "0")}`;
      if (isHeldOut(phone, "camp-a", 50) !== isHeldOut(phone, "camp-b", 50)) differ++;
    }
    // Independent 50/50 coins disagree about half the time; a campaign-blind
    // hash would disagree never.
    expect(differ).toBeGreaterThan(2000);
    expect(differ).toBeLessThan(3000);
  });

  it("KNOWN-BAD CONTROL: a campaign-blind coin fails the independence test the real one passes", () => {
    // Self-test for the test above: if the assertion could pass on a broken
    // implementation it proves nothing. This is that broken implementation.
    const campaignBlind = (phone: string) => isHeldOut(phone, "same", 50);
    let differ = 0;
    for (let i = 0; i < 5000; i++) {
      const phone = `+6142${String(i).padStart(6, "0")}`;
      if (campaignBlind(phone) !== campaignBlind(phone)) differ++;
    }
    expect(differ).toBe(0); // and 0 < 2000, so the test above would fail. Good.
  });
});

describe("holdoutKey — which campaign id the coin is tied to", () => {
  it("uses the PARENT id for a recurring child, so the coin survives tomorrow's spawn", () => {
    // Recurring campaigns spawn a fresh child every day. Keyed on the child id a
    // held-out player would be dialled the next morning and the arms would mix.
    const monday = { id: "child-mon", parent_campaign_id: "parent-1" };
    const tuesday = { id: "child-tue", parent_campaign_id: "parent-1" };
    expect(holdoutKey(monday)).toBe("parent-1");
    expect(holdoutKey(tuesday)).toBe("parent-1");
    expect(isHeldOut("+61400000001", holdoutKey(monday), 10)).toBe(
      isHeldOut("+61400000001", holdoutKey(tuesday), 10),
    );
  });

  it("uses its own id for a one-off campaign", () => {
    expect(holdoutKey({ id: "camp-a", parent_campaign_id: null })).toBe("camp-a");
    expect(holdoutKey({ id: "camp-a" })).toBe("camp-a");
  });
});

describe("HOLDOUT_OUTCOME", () => {
  it("is the exact string the CHECK constraint allows", () => {
    // supabase-migration-holdout.sql adds this literal. A typo here writes a row
    // Postgres rejects with 23514, so the two are pinned together by this test.
    expect(HOLDOUT_OUTCOME).toBe("holdout");
  });
});
