import { describe, expect, it } from "vitest";
import { classifyOptout, normalizeMsisdn, planSmsUpdate, staleDeleteAllowed } from "./mobivateReconcile";
import type { MobivateHistoryRecord } from "./mobivateRead";

const NOW = "2026-09-08T04:20:00.000Z";
const rec = (over: Partial<MobivateHistoryRecord>): MobivateHistoryRecord => ({
  id: "m1", reference: "r1", status: "DELIVERED", price: 0.037, currency: "EUR", parts: 1,
  created_at: "2026-09-06T00:00:00.000Z", updated_at: "2026-09-06T00:00:05.000Z", ...over,
});
const row = (status: string) => ({ id: "r1", status, created_at: "2026-09-06T00:00:00.000Z" });

describe("planSmsUpdate", () => {
  it("closes a 'sent' row to delivered with its cost, clears error_message", () => {
    expect(planSmsUpdate(row("sent"), rec({ status: "DELIVERED" }), NOW)).toEqual({
      update: { status: "delivered", error_message: null, price_eur: 0.037, parts: 1, reconciled_at: NOW }, unmappedWord: null,
    });
  });
  it("closes a 'sent' row that Mobivate dropped for an opt-out to failed, with the raw word", () => {
    const { update } = planSmsUpdate(row("sent"), rec({ status: "OPTED_OUT", price: 0, parts: 0 }), NOW);
    expect(update).toEqual({ status: "failed", error_message: "OPTED_OUT (Mobivate message history)", price_eur: 0, parts: 0, reconciled_at: NOW });
  });
  it("maps UNDELIVERABLE to undelivered, the receipt route's vocabulary", () => {
    expect(planSmsUpdate(row("sent"), rec({ status: "UNDELIVERABLE" }), NOW).update?.status).toBe("undelivered");
    expect(planSmsUpdate(row("sent"), rec({ status: "UNDELIVERABLE" }), NOW).update?.error_message).toBe("UNDELIVERABLE (Mobivate message history)");
  });
  it("leaves a row alone while Mobivate still says CREATED or SENT (in flight), but keeps the cost", () => {
    for (const w of ["CREATED", "SENT"]) {
      const { update, unmappedWord } = planSmsUpdate(row("sent"), rec({ status: w }), NOW);
      expect(update).toEqual({ price_eur: 0.037, parts: 1 });
      expect(unmappedWord).toBeNull();
    }
  });
  it("never flips a status a delivery receipt already decided", () => {
    for (const s of ["delivered", "failed", "undelivered"]) {
      const { update } = planSmsUpdate(row(s), rec({ status: "OPTED_OUT" }), NOW);
      expect(update).toEqual({ price_eur: 0.037, parts: 1, reconciled_at: NOW });
    }
  });
  it("reports an unknown word and does NOT flip on it (a new Mobivate word must not unblock a re-text)", () => {
    const { update, unmappedWord } = planSmsUpdate(row("sent"), rec({ status: "SOMETHING_NEW" }), NOW);
    expect(update).toEqual({ price_eur: 0.037, parts: 1 });
    expect(unmappedWord).toBe("SOMETHING_NEW");
  });
  it("stores no price when the currency is not EUR, and no parts when absent", () => {
    const { update } = planSmsUpdate(row("sent"), rec({ status: "DELIVERED", currency: "USD", parts: null }), NOW);
    // The money guard is `if (priceEur !== null || parts !== null)`, so with neither present the keys are
    // never set. vitest's toEqual treats an ABSENT key as unequal to an explicit `null` (it forgives only
    // `undefined`) — verified empirically 2026-09-07 — so the expectation must omit them, not spell them null.
    expect(update).toEqual({ status: "delivered", error_message: null, reconciled_at: NOW });
    expect(update).not.toHaveProperty("price_eur");
  });
  it("returns null when there is nothing to write (already reconciled row, in-flight word, no money)", () => {
    expect(planSmsUpdate(row("delivered"), rec({ status: "SENT", price: null, parts: null }), NOW).update).toBeNull();
  });
});

describe("classifyOptout", () => {
  it("reads Mobivate's notes", () => {
    expect(classifyOptout("Rule Based Action: 3x UNDELIVERABLE")).toBe("dead_number");
    expect(classifyOptout("Opted out via qwt5.me")).toBe("player_opt_out");
    expect(classifyOptout("Opted out via qwt1.me")).toBe("player_opt_out");
    expect(classifyOptout("Pasted Optout")).toBe("crm_pasted");
    expect(classifyOptout("Created via File Upload rooster optouts ")).toBe("crm_pasted");
    expect(classifyOptout(null)).toBe("unknown");
    expect(classifyOptout("STOP reply")).toBe("unknown");
  });
});

describe("normalizeMsisdn", () => {
  it("adds the plus and strips everything else; refuses stubs", () => {
    expect(normalizeMsisdn("64211657305")).toBe("+64211657305");
    expect(normalizeMsisdn("+61 417 633 305")).toBe("+61417633305");
    expect(normalizeMsisdn("1234567")).toBeNull();
    expect(normalizeMsisdn("")).toBeNull();
  });
});

describe("staleDeleteAllowed", () => {
  it("allows the stale sweep only when the pull is at least 90% of the last count (a partial pull must not un-block anyone)", () => {
    expect(staleDeleteAllowed(4504, 4510)).toBe(true);
    expect(staleDeleteAllowed(4504, 4100)).toBe(true);
    expect(staleDeleteAllowed(4504, 4000)).toBe(false);
    expect(staleDeleteAllowed(0, 4504)).toBe(true);
    expect(staleDeleteAllowed(4504, 0)).toBe(false);
  });
});
