import { describe, expect, it } from "vitest";
import { TOUCH_WINDOWS, lastTouchBefore, rollUpLastTouch, type Touch } from "./lastTouch";

const H = 3_600_000;
const DEP = Date.UTC(2026, 8, 8, 12, 0, 0);
const t = (hoursAgoFromDeposit: number, kind: Touch["kind"]): Touch => ({ at: DEP - hoursAgoFromDeposit * H, kind });

describe("lastTouchBefore", () => {
  it("picks the LATEST touch at or before the deposit", () => {
    expect(lastTouchBefore(DEP, [t(50, "call"), t(2, "sms_delivered"), t(30, "call_spoke")], 7 * 24 * H))
      .toEqual({ kind: "sms_delivered", ageMs: 2 * H });
  });

  it("ignores a touch AFTER the deposit (a text sent later cannot have caused it)", () => {
    expect(lastTouchBefore(DEP, [t(-3, "sms_delivered"), t(10, "call")], 7 * 24 * H))
      .toEqual({ kind: "call", ageMs: 10 * H });
  });

  it("ignores a touch older than the window", () => {
    expect(lastTouchBefore(DEP, [t(40, "call")], 24 * H)).toEqual({ kind: "none", ageMs: null });
    expect(lastTouchBefore(DEP, [t(40, "call")], 72 * H)).toEqual({ kind: "call", ageMs: 40 * H });
  });

  it("counts a touch exactly at the deposit instant and exactly at the window edge", () => {
    expect(lastTouchBefore(DEP, [t(0, "call")], 24 * H)).toEqual({ kind: "call", ageMs: 0 });
    expect(lastTouchBefore(DEP, [t(24, "call")], 24 * H)).toEqual({ kind: "call", ageMs: 24 * H });
  });

  it("returns none for a player with no touches at all", () => {
    expect(lastTouchBefore(DEP, [], 7 * 24 * H)).toEqual({ kind: "none", ageMs: null });
  });

  it("does not require sorted input", () => {
    expect(lastTouchBefore(DEP, [t(1, "call"), t(99, "call_spoke"), t(5, "sms")], 7 * 24 * H).kind).toBe("call");
  });

  it("on an exact timestamp tie prefers the stronger evidence, so a conversation outranks a dial", () => {
    // Same instant, both valid: a 30s+ conversation is better evidence of contact than the dial
    // record beside it, and a delivered text better than an unconfirmed one.
    expect(lastTouchBefore(DEP, [t(3, "call"), t(3, "call_spoke")], 24 * H).kind).toBe("call_spoke");
    expect(lastTouchBefore(DEP, [t(3, "sms"), t(3, "sms_delivered")], 24 * H).kind).toBe("sms_delivered");
  });

  it("ignores a touch with an unparseable timestamp instead of ranking it first", () => {
    expect(lastTouchBefore(DEP, [{ at: NaN, kind: "call_spoke" }, t(6, "sms")], 24 * H).kind).toBe("sms");
  });
});

describe("rollUpLastTouch", () => {
  it("tallies every deposit into exactly one bucket and totals back", () => {
    const deposits = [
      { at: DEP, key: "a" },
      { at: DEP, key: "b" },
      { at: DEP, key: "c" },
      { at: DEP, key: "missing" },
    ];
    const touches = new Map<string, Touch[]>([
      ["a", [t(1, "call_spoke")]],
      ["b", [t(2, "sms_delivered")]],
      ["c", [t(400, "call")]], // outside every window
    ]);
    const out = rollUpLastTouch(deposits, touches, 24 * H);
    expect(out).toEqual({ call_spoke: 1, sms_delivered: 1, none: 2, call: 0, sms: 0 });
    expect(Object.values(out).reduce((a, b) => a + b, 0)).toBe(deposits.length);
  });

  it("a deposit whose player we cannot identify counts as none, never dropped", () => {
    const out = rollUpLastTouch([{ at: DEP, key: "nobody" }], new Map(), 24 * H);
    expect(out.none).toBe(1);
    expect(Object.values(out).reduce((a, b) => a + b, 0)).toBe(1);
  });
});

describe("TOUCH_WINDOWS", () => {
  it("are the three the spec asks for, in hours", () => {
    expect(TOUCH_WINDOWS.map(([l]) => l)).toEqual(["24h", "72h", "7d"]);
    expect(TOUCH_WINDOWS.map(([, ms]) => ms / H)).toEqual([24, 72, 168]);
  });
});
