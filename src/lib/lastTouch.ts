// What came before a deposit (VOZ-509, Jasiel 2026-09-08: "build the last-touch card").
//
// ⚠️ READ THIS BEFORE PUTTING A WORD LIKE "ORGANIC" ON THE SCREEN. We hold NO lane-wide record of
// CRM email, bonus or login activity: `cio_events` contains deposits and nothing else (9,954 rows,
// all `deposit_made`, measured 2026-09-08). So a deposit with no Voizo touch in the window means
// "no touch WE CAN SEE", never "nothing influenced this player". Measured on the 1,239 deposits we
// can tie to a phone we hold: 90.7% have no visible touch at 24h, 82.7% at 72h, 72.0% at 7d, and
// most of that bucket is CRM activity we cannot read yet. The honest claim this module supports is
// "the deposit followed a Voizo touch within N", which is PROXIMITY, not cause: the 25 Aug study
// found contacted and never-reached players deposit at the same rate. Only a holdout proves lift.
// When the nightly CIO pull lands (VOZ-461/479), add its touch kinds here and the bucket splits.
//
// Pure: no I/O, no Date.now. The caller supplies deposits and touches already in hand.

/** A touch we can actually see, strongest evidence first. */
export type TouchKind = "call_spoke" | "sms_delivered" | "call" | "sms";

/** Rank for the exact-timestamp tie only: a 30s+ conversation is better evidence of contact than
 *  the dial record logged beside it, and a delivered text than an unconfirmed one. */
const RANK: Record<TouchKind, number> = { call_spoke: 4, sms_delivered: 3, call: 2, sms: 1 };

export interface Touch {
  /** Epoch ms. A NaN is ignored rather than ranked. */
  at: number;
  kind: TouchKind;
}

export type LastTouchLabel = TouchKind | "none";

/** The latest visible touch at or before `depositAt` and no older than `windowMs`. */
export function lastTouchBefore(depositAt: number, touches: Touch[], windowMs: number): { kind: LastTouchLabel; ageMs: number | null } {
  let best: Touch | null = null;
  for (const x of touches) {
    if (!Number.isFinite(x.at)) continue;
    const age = depositAt - x.at;
    if (age < 0 || age > windowMs) continue; // after the deposit, or too old to be the last touch
    if (!best || x.at > best.at || (x.at === best.at && RANK[x.kind] > RANK[best.kind])) best = x;
  }
  return best ? { kind: best.kind, ageMs: depositAt - best.at } : { kind: "none", ageMs: null };
}

/** The three look-back windows the card offers. */
export const TOUCH_WINDOWS: readonly (readonly [string, number])[] = [
  ["24h", 24 * 3_600_000],
  ["72h", 72 * 3_600_000],
  ["7d", 168 * 3_600_000],
] as const;

export type LastTouchRollUp = Record<LastTouchLabel, number>;

/** One bucket per deposit, always. A deposit whose player we cannot identify counts as `none`
 *  rather than vanishing: a denominator that silently shrinks is how a share becomes a lie. */
export function rollUpLastTouch(
  deposits: { at: number; key: string }[],
  touchesByKey: Map<string, Touch[]>,
  windowMs: number,
): LastTouchRollUp {
  const out: LastTouchRollUp = { call_spoke: 0, sms_delivered: 0, call: 0, sms: 0, none: 0 };
  for (const d of deposits) {
    const { kind } = lastTouchBefore(d.at, touchesByKey.get(d.key) ?? [], windowMs);
    out[kind]++;
  }
  return out;
}
