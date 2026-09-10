// holdout — the coin that decides whether a candidate is called or withheld.
//
// Why this exists (task: .agent/tasks/2026-09-08_TASK_deposit_holdout_design.md):
// every observational number Voizo has produced about "does calling a player make
// them deposit" is confounded, because Voizo chooses who to call. Withholding a
// random share of the players we WOULD have called is the only design that
// answers it. This module is the randomiser, and nothing else.
//
// PURE and deterministic on purpose. The coin is a hash of the player and the
// campaign, not a random draw at dial time, because:
//   - a retry must not re-flip it, or a player drifts between arms mid-run;
//   - it needs no new state and survives a restart or a redeploy;
//   - arm membership stays DERIVABLE, so a failed bookkeeping write loses the
//     record but never the assignment (the dialer relies on this).
//
// The default is 0 everywhere. No campaign changes behaviour until someone sets
// campaigns_v2.holdout_pct, and at 0 this module answers false without hashing.

import { createHash } from "node:crypto";

/** campaign_numbers_v2.outcome written for a withheld player. Pinned to the
 *  CHECK constraint in supabase-migration-holdout.sql by holdout.test.ts —
 *  a mismatch is a Postgres 23514 on every withheld row. */
export const HOLDOUT_OUTCOME = "holdout";

/**
 * Which campaign id the coin is tied to.
 *
 * Recurring campaigns spawn a fresh child every day, so keying on the child id
 * would re-flip the coin each morning: a player withheld on Monday gets dialled
 * on Tuesday, both arms fill with the same people, and the comparison measures
 * nothing. The parent is the stable identity of the campaign a player is in.
 */
export function holdoutKey(campaign: { id: string; parent_campaign_id?: string | null }): string {
  return campaign.parent_campaign_id ?? campaign.id;
}

/**
 * Is this player withheld from contact in this campaign?
 *
 * `pct` is the share withheld, 0-100. Anything that is not a usable percentage
 * (null, NaN, negative, a fraction below 1) reads as 0: a bad column value must
 * fail towards CALLING people, never towards silently withholding contact.
 */
export function isHeldOut(playerKey: string, campaignKey: string, pct: number): boolean {
  const share = Math.floor(Number(pct));
  if (!Number.isFinite(share) || share <= 0) return false;
  if (share >= 100) return true;
  // sha1 over "player|campaign": stdlib, uniform enough that 100k ids land
  // within a point of the target (asserted in the tests), and stable across
  // processes and node versions in a way a hand-rolled string hash is not.
  const digest = createHash("sha1").update(`${playerKey}|${campaignKey}`).digest();
  // First 4 bytes as an unsigned int. mod 100 over a 2^32 range: the bias
  // towards low buckets is under one part in forty million, far below the
  // sampling noise of any arm we will ever fill.
  return digest.readUInt32BE(0) % 100 < share;
}
