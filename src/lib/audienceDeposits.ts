// audienceDeposits — the money strip's numbers, following the Depositors table's filters.
//
// Jasiel 2026-09-10: "a number beside a filter should obey it". The strip and the Deposits-by-day
// chart used to describe the whole window for every contacted player while Deposited / Contact /
// Family / search shaped only the table beneath them. This module reads ONE database function,
// audience_lane_deposit_rollup (2026-09-10_audience_lane_deposit_rollup_rpc.sql), which applies the
// table's population rules and returns three grains in one round trip: per day, per currency, and
// the distinct depositor total. With every filter at "any" the function equals the two older
// functions to the row (its gate proves that), so the unfiltered strip does not change.
//
// Pure mapping plus one RPC; the route owns auth, scope resolution and the response envelope.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { AudienceDeposits, DepositDay, DepositTotal } from "@/app/api/audience/reach/route";

export interface DepositFilters {
  deposited: string;
  contact: string;
  /** Campaign ids of the chosen family, or null for all. Resolved by the route with the tab's own rule. */
  familyIds: string[] | null;
  /** Sanitised the way the players route sanitises it (no % _ \, 60 chars), or null. */
  q: string | null;
}

type RollupRow = {
  grain: "day" | "currency" | "total";
  day: string | null;
  currency: string | null;
  deposits: number;
  players: number;
  amount_local: number | string | null;
  amount_eur: number | string | null;
  deposits_before: number;
};

/** The three grains, mapped to the shapes the strip already renders. `depositors` is the total
 *  grain's distinct-player count, so a player who deposited in two currencies counts once. */
export function mapRollup(rows: RollupRow[]): { days: DepositDay[]; totals: DepositTotal[]; depositors: number } {
  const days: DepositDay[] = [];
  const totals: DepositTotal[] = [];
  let depositors = 0;
  for (const r of rows) {
    if (r.grain === "day" && r.day) {
      days.push({ day: r.day, deposits: r.deposits, players: r.players, amountEur: Number(r.amount_eur) || 0, depositsBefore: r.deposits_before });
    } else if (r.grain === "currency") {
      totals.push({ currency: r.currency ?? "?", deposits: r.deposits, players: r.players, amountLocal: Number(r.amount_local) || 0, amountEur: Number(r.amount_eur) || 0, before: r.deposits_before });
    } else if (r.grain === "total") {
      depositors = r.players;
    }
  }
  // Same orders the older functions returned: days ascending, currencies by EUR descending.
  days.sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
  totals.sort((a, b) => b.amountEur - a.amountEur);
  return { days, totals, depositors };
}

/** What the table can actually see: the one-off 2026-08-25 capture and the live ingress. A day
 *  outside both is "not captured", never "no deposits". Lifted from the reach route unchanged. */
export const CAPTURE_SOURCE = "activities_capture_2026-08-25";
export async function depositCoverage(supabase: SupabaseClient): Promise<AudienceDeposits["coverage"]> {
  const one = async (col: string, asc: boolean, captured: boolean) => {
    let q = supabase.from("cio_events").select(col).eq("event_name", "deposit_made");
    q = captured ? q.eq("payload->>source", CAPTURE_SOURCE) : q.filter("payload->>source", "is", null);
    const { data, error } = await q.order(col, { ascending: asc }).limit(1);
    if (error) throw new Error(error.message);
    const row = (data as unknown as Record<string, string>[] | null)?.[0];
    return row ? row[col] : null;
  };
  const [captureFrom, captureTo, liveFrom] = await Promise.all([one("occurred_at", true, true), one("occurred_at", false, true), one("received_at", true, false)]);
  return { captureFrom, captureTo, liveFrom };
}

export async function loadDeposits(
  supabase: SupabaseClient,
  campaignIds: string[],
  fromIso: string,
  toIso: string,
  f: DepositFilters,
): Promise<AudienceDeposits> {
  const rollupOnce = async () => {
    const { data, error } = await supabase.rpc("audience_lane_deposit_rollup", {
      p_campaign_ids: campaignIds,
      p_from: fromIso,
      p_to: toIso,
      p_deposited: f.deposited,
      p_contact: f.contact,
      p_family_ids: f.familyIds,
      p_q: f.q,
    });
    if (error) throw new Error(error.message);
    return mapRollup((data ?? []) as RollupRow[]);
  };
  const [rollup, coverage] = await Promise.all([
    (async () => {
      try {
        return await rollupOnce();
      } catch (e) {
        // The page fetches this, the reach route and the players list together. Alone the all-time,
        // all-brands call answers in about 1.3 s (measured 2026-09-10); fired beside the reach route's
        // nine calls it once crossed the 8 s statement limit. One retry after the contention has
        // passed turns that into a slower answer instead of a blank card. Anything else rethrows.
        if (!(e instanceof Error && /statement timeout|57014/i.test(e.message))) throw e;
        await new Promise((r) => setTimeout(r, 1500));
        return await rollupOnce();
      }
    })(),
    depositCoverage(supabase),
  ]);
  return { from: fromIso, to: toIso, days: rollup.days, totals: rollup.totals, depositors: rollup.depositors, coverage };
}
