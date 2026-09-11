import { describe, expect, it } from "vitest";
import {
  CIO_MESSAGE_ROW_KEYS,
  deriveTimestamps,
  pullWindow,
  sanitizeMetrics,
  toMessageRow,
  type CioApiMessage,
} from "./cioMessages";

// 2026-09-12T12:00:00Z. Injected everywhere so nothing in these tests depends on the wall clock.
const NOW_MS = 1_789_214_400_000;
const NOW_S = NOW_MS / 1000;
const PULLED = "2026-09-12T12:00:00.000Z";

/** A real message, shaped from a 526-message probe of the live API on 2026-09-12. Note that
 *  `recipient`, `customer_identifiers` and `customer_id` are present on 100% of real responses —
 *  they are in this fixture precisely so the tests can prove they never reach a row. */
const msg = (over: Partial<CioApiMessage> = {}): CioApiMessage => ({
  id: "dgSi9wcBAMGkEsCkEgGgj8f0ybwaFSmtpNBmXFc=",
  deduplicate_id: "dgSi9wcBAMGkEsCkEgGgj8f0ybwaFSmtpNBmXFc=:1789118642",
  type: "email",
  campaign_id: 315,
  broadcast_id: null,
  newsletter_id: null,
  msg_template_id: 23710,
  action_id: 14486,
  parent_action_id: null,
  content_id: null,
  transactional_message_id: null,
  subject: "Your weekend bonus is waiting",
  failure_message: null,
  created: 1_789_118_640,
  forgotten: false,
  metrics: { sent: 1_789_118_641, delivered: 1_789_118_642 },
  // Everything below must never be stored.
  recipient: "player@example.com",
  customer_identifiers: { id: "lucky7even:158491", email: "player@example.com", cio_id: "a2f70709" },
  customer_id: "lucky7even:158491",
  trigger_event_id: "evt_123",
  ...over,
});

describe("deriveTimestamps", () => {
  it("turns the epoch map into ISO stamps", () => {
    const t = deriveTimestamps({ sent: 1_789_118_641, delivered: 1_789_118_642 }, NOW_MS);
    expect(t.sent_at).toBe("2026-09-11T09:24:01.000Z");
    expect(t.delivered_at).toBe("2026-09-11T09:24:02.000Z");
    expect(t.rejected).toEqual([]);
  });

  // THE KNOWN-BAD CONTROL the design asks for by name (§7): a metrics map with no `sent`
  // must not produce a sent_at. 11 of 526 probed messages have exactly this shape.
  it("leaves sent_at NULL when the map carries no `sent` — never invents one", () => {
    const t = deriveTimestamps({ delivered: 1_789_118_642 }, NOW_MS);
    expect(t.sent_at).toBeNull();
    expect(t.delivered_at).not.toBeNull();
  });

  it("maps every derived column and leaves the rest null", () => {
    const t = deriveTimestamps(
      { sent: NOW_S - 60, delivered: NOW_S - 50, opened: NOW_S - 40, clicked: NOW_S - 30, converted: NOW_S - 20, failed: NOW_S - 10 },
      NOW_MS,
    );
    for (const k of ["sent_at", "delivered_at", "opened_at", "clicked_at", "converted_at", "failed_at"] as const) {
      expect(t[k], k).not.toBeNull();
    }
  });

  it("returns all-null for an empty, missing, or non-object map instead of throwing", () => {
    for (const bad of [{}, null, undefined, "nope", 42, [1, 2, 3]] as unknown[]) {
      const t = deriveTimestamps(bad as Record<string, unknown> | null, NOW_MS);
      expect(t.sent_at, String(bad)).toBeNull();
      expect(t.delivered_at, String(bad)).toBeNull();
    }
  });

  // MILLISECONDS. Customer.io sends seconds today (every one of 526 probed values was 10 digits).
  // The day one arrives in milliseconds, new Date(1.789e12 * 1000) is the year 58,000 — a silently
  // corrupt row that every type check passes. The sane-range guard is what catches it.
  it("rejects a millisecond timestamp instead of writing the year 58,000", () => {
    const t = deriveTimestamps({ sent: 1_789_118_641_000 }, NOW_MS);
    expect(t.sent_at).toBeNull();
    expect(t.rejected).toContain("sent");
  });

  it("rejects epoch 0, negatives, NaN and Infinity rather than dating a row to 1970", () => {
    for (const bad of [0, -1, -1_789_118_641, NaN, Infinity, -Infinity]) {
      const t = deriveTimestamps({ sent: bad }, NOW_MS);
      expect(t.sent_at, String(bad)).toBeNull();
    }
  });

  it("rejects a stamp before 2000 or more than a year ahead", () => {
    expect(deriveTimestamps({ sent: 946_684_799 }, NOW_MS).sent_at).toBeNull(); // 1999-12-31
    expect(deriveTimestamps({ sent: NOW_S + 400 * 86400 }, NOW_MS).sent_at).toBeNull();
    expect(deriveTimestamps({ sent: NOW_S + 86400 }, NOW_MS).sent_at).not.toBeNull(); // tomorrow is fine
  });

  it("accepts a numeric string, so a format change does not blank every stamp in silence", () => {
    expect(deriveTimestamps({ sent: "1789118641" }, NOW_MS).sent_at).toBe("2026-09-11T09:24:01.000Z");
  });

  it("names every rejected key so the job can report them rather than swallow them", () => {
    const t = deriveTimestamps({ sent: 1_789_118_641_000, opened: -5, delivered: 1_789_118_642 }, NOW_MS);
    expect(t.rejected.sort()).toEqual(["opened", "sent"]);
  });
});

describe("sanitizeMetrics", () => {
  it("keeps the numeric epoch map whole, link stamps included", () => {
    expect(sanitizeMetrics({ sent: 1, "link:3159": 2, "human_opened": 3 })).toEqual({
      sent: 1, "link:3159": 2, human_opened: 3,
    });
  });

  it("drops any non-numeric value, so nothing identifying can arrive through metrics", () => {
    expect(sanitizeMetrics({ sent: 1, note: "player@example.com", nested: { a: 1 }, list: [1] })).toEqual({ sent: 1 });
  });

  it("drops NaN and Infinity, which are not valid jsonb numbers", () => {
    expect(sanitizeMetrics({ a: NaN, b: Infinity, c: 5 })).toEqual({ c: 5 });
  });

  it("returns {} for a missing or non-object map", () => {
    for (const bad of [null, undefined, "x", 7, []] as unknown[]) {
      expect(sanitizeMetrics(bad as Record<string, unknown> | null)).toEqual({});
    }
  });
});

describe("toMessageRow", () => {
  it("builds a row from a real message", () => {
    const row = toMessageRow("fortuneplay", "a2f70709", msg(), PULLED, NOW_MS);
    expect(row).toMatchObject({
      workspace: "fortuneplay",
      cio_id: "a2f70709",
      message_id: "dgSi9wcBAMGkEsCkEgGgj8f0ybwaFSmtpNBmXFc=",
      type: "email",
      campaign_id: 315,
      msg_template_id: 23710,
      action_id: 14486,
      subject: "Your weekend bonus is waiting",
      sent_at: "2026-09-11T09:24:01.000Z",
      delivered_at: "2026-09-11T09:24:02.000Z",
      opened_at: null,
      cio_created_at: "2026-09-11T09:24:00.000Z",
      pulled_at: PULLED,
    });
  });

  // The assertion that matters most. `recipient` and `customer_identifiers` are on 100% of real
  // API responses, so this is not hypothetical: an allowlist is the only thing standing between
  // the player's email and our database. An exact key-set comparison fails loudly the day someone
  // "simplifies" the mapping into a spread.
  it("carries no recipient, no identifiers, and nothing outside the allowlist", () => {
    const row = toMessageRow("fortuneplay", "a2f70709", msg(), PULLED, NOW_MS)!;
    expect(Object.keys(row).sort()).toEqual([...CIO_MESSAGE_ROW_KEYS].sort());
    for (const banned of ["recipient", "customer_identifiers", "customer_id", "trigger_event_id", "deduplicate_id"]) {
      expect(row, banned).not.toHaveProperty(banned);
    }
    expect(JSON.stringify(row)).not.toContain("player@example.com");
    expect(JSON.stringify(row)).not.toContain("lucky7even:158491");
  });

  it("refuses a message Customer.io has been asked to forget", () => {
    expect(toMessageRow("fortuneplay", "a2f70709", msg({ forgotten: true }), PULLED, NOW_MS)).toBeNull();
  });

  it("refuses a message with no id, which could not be keyed anyway", () => {
    for (const bad of [undefined, null, ""] as unknown[]) {
      expect(toMessageRow("fortuneplay", "a2f70709", msg({ id: bad as string }), PULLED, NOW_MS)).toBeNull();
    }
  });

  it("passes an unknown channel through untouched — Customer.io owns that vocabulary", () => {
    // `inbox` was not in the design's list and turned up in the live probe. The next one will not
    // be in ours either, and it must not fail the row.
    for (const t of ["inbox", "in_app", "webhook", "carrier_pigeon"]) {
      expect(toMessageRow("fortuneplay", "a", msg({ type: t }), PULLED, NOW_MS)?.type).toBe(t);
    }
  });

  it("keeps nulls as nulls and never coerces a missing id to 0", () => {
    const row = toMessageRow("fortuneplay", "a", msg({ campaign_id: null, broadcast_id: null, content_id: null }), PULLED, NOW_MS)!;
    expect(row.campaign_id).toBeNull();
    expect(row.broadcast_id).toBeNull();
    expect(row.content_id).toBeNull();
  });

  it("stores the metrics map whole, sanitised", () => {
    const row = toMessageRow("fortuneplay", "a", msg({ metrics: { sent: 1_789_118_641, "link:42": 1_789_118_641, junk: "x" } }), PULLED, NOW_MS)!;
    expect(row.metrics).toEqual({ sent: 1_789_118_641, "link:42": 1_789_118_641 });
  });
});

describe("pullWindow", () => {
  const DAY = 86_400;

  it("first pull reaches back 7 days before the player was contacted, to see what preceded our call", () => {
    const contacted = "2026-09-10T00:00:00.000Z";
    const w = pullWindow({ lastMessageAt: null, contactedAt: contacted }, NOW_MS);
    expect(w.startTs).toBe(Math.floor(Date.parse(contacted) / 1000) - 7 * DAY);
    expect(w.endTs).toBe(Math.floor(NOW_S));
  });

  it("later pulls reach back 48 hours from the newest message, so late metric updates are caught", () => {
    const last = "2026-09-11T00:00:00.000Z";
    const w = pullWindow({ lastMessageAt: last, contactedAt: "2026-08-01T00:00:00.000Z" }, NOW_MS);
    expect(w.startTs).toBe(Math.floor(Date.parse(last) / 1000) - 2 * DAY);
  });

  it("falls back to 30 days when it knows neither date — never NaN, never undefined", () => {
    const w = pullWindow({ lastMessageAt: null, contactedAt: null }, NOW_MS);
    expect(w.startTs).toBe(Math.floor(NOW_S) - 30 * DAY);
    expect(Number.isFinite(w.startTs)).toBe(true);
  });

  it("falls back the same way on an unparseable date rather than sending NaN to the API", () => {
    const w = pullWindow({ lastMessageAt: "not a date", contactedAt: "also not a date" }, NOW_MS);
    expect(Number.isFinite(w.startTs)).toBe(true);
    expect(w.startTs).toBe(Math.floor(NOW_S) - 30 * DAY);
  });

  // Clock skew is the one that would 400 the API or return nothing at all, silently.
  it("never lets start run past end, even when a stored date is in the future", () => {
    const w = pullWindow({ lastMessageAt: "2027-01-01T00:00:00.000Z", contactedAt: null }, NOW_MS);
    expect(w.startTs).toBeLessThan(w.endTs);
  });

  it("always returns whole seconds — the API takes epoch seconds, not milliseconds", () => {
    const w = pullWindow({ lastMessageAt: "2026-09-11T00:00:00.500Z", contactedAt: null }, NOW_MS);
    expect(Number.isInteger(w.startTs)).toBe(true);
    expect(Number.isInteger(w.endTs)).toBe(true);
  });
});
