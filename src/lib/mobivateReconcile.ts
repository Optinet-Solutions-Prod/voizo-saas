// Pure decisions for the nightly Mobivate reconcile (2026-09-07). No I/O, no Date.now: the cron
// route feeds rows and records in and writes what comes out, so every rule here is unit-tested.
import { normalizeSmsStatus, type SmsStatus } from "./mobivateDeliveryReceipt";
import type { MobivateHistoryRecord } from "./mobivateRead";

/** Mobivate's final words, every one seen in the 170,524-row export of 19 Aug..7 Sep 2026. A word
 *  outside this set is reported, never acted on: an unknown word flipping a row to 'failed' would
 *  unblock a second text to that player (both dispatch paths treat 'failed' as non-blocking). */
export const FINAL_WORDS: ReadonlySet<string> = new Set([
  "DELIVERED", "UNDELIVERABLE", "UNDELIVERED", "OPTED_OUT", "EXPIRED", "FAILED", "REJECTED",
  "FAILED_ROUTE_INVALID", "INVALID_RECIPIENT", "NETWORK_NOT_COVERED", "SUBMIT_FAIL", "UNKNOWN", "LIMITS_EXCEEDED",
]);
/** Still moving: leave our row as it is, look again tomorrow. */
export const IN_FLIGHT_WORDS: ReadonlySet<string> = new Set(["CREATED", "SENT", "ACCEPTED", "ENROUTE", "SCHEDULED"]);

export type OptoutKind = "dead_number" | "player_opt_out" | "crm_pasted" | "unknown";

/** Mobivate's note on an opt-out row, as exported 2026-09-07: 3,553 "Rule Based Action: 3x
 *  UNDELIVERABLE" (their dead-number rule), 206 "Opted out via qwt5.me / qwt1.me" (the player
 *  tapped the opt-out link), 745 pasted or uploaded by the CRM team. Only player_opt_out is a
 *  consent record; the rest only mean "Mobivate will not deliver". */
export function classifyOptout(note: string | null | undefined): OptoutKind {
  if (!note) return "unknown";
  if (/3x UNDELIVERABLE/i.test(note)) return "dead_number";
  if (/Opted out via qwt\d\.me/i.test(note)) return "player_opt_out";
  if (/Pasted Optout|File Upload/i.test(note)) return "crm_pasted";
  return "unknown";
}

/** Mobivate writes "64211657305"; we store "+64211657305". Under 8 digits is not a phone number. */
export function normalizeMsisdn(msisdn: string): string | null {
  const digits = String(msisdn ?? "").replace(/\D/g, "");
  return digits.length >= 8 ? `+${digits}` : null;
}

export interface SmsRowForReconcile { id: string; status: string; created_at: string }
export interface SmsReconcileUpdate {
  status?: SmsStatus;
  error_message?: string | null;
  price_eur?: number | null;
  parts?: number | null;
  reconciled_at?: string;
}

const OPEN_STATUSES = new Set(["sent", "queued"]);

/** What the reconcile writes for one of our rows given Mobivate's record of the same text. */
export function planSmsUpdate(row: SmsRowForReconcile, rec: MobivateHistoryRecord, nowIso: string): { update: SmsReconcileUpdate | null; unmappedWord: string | null } {
  const update: SmsReconcileUpdate = {};
  const priceEur = rec.currency === "EUR" && rec.price !== null ? rec.price : null;
  const parts = rec.parts !== null && Number.isInteger(rec.parts) ? rec.parts : null;
  if (priceEur !== null || parts !== null) { update.price_eur = priceEur; update.parts = parts; }

  const word = rec.status;
  let unmappedWord: string | null = null;
  if (FINAL_WORDS.has(word)) {
    if (OPEN_STATUSES.has(row.status)) {
      const status = normalizeSmsStatus(word);
      update.status = status;
      update.error_message = status === "delivered" ? null : `${word} (Mobivate message history)`;
    }
    update.reconciled_at = nowIso;
  } else if (!IN_FLIGHT_WORDS.has(word)) {
    unmappedWord = word;
  }
  return { update: Object.keys(update).length ? update : null, unmappedWord };
}

/** The stale sweep removes mirror rows Mobivate no longer lists. A short pull (network blip, a
 *  changed page cap) must not un-block hundreds of numbers, so it runs only when the pull is at
 *  least 90% of what we held before. First pull (nothing held) always passes. */
export function staleDeleteAllowed(previousCount: number, pulledCount: number): boolean {
  if (previousCount <= 0) return pulledCount > 0;
  return pulledCount >= Math.ceil(previousCount * 0.9);
}
