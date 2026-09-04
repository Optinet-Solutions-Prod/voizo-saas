-- 2026-09-04 Audience lane reach RPC — proposed, NOT YET APPLIED to prod.
--
-- WHY: every headline number on the Audience tab is a count of DISTINCT PLAYERS, not of rows:
-- "Members", the Reach card's four bars, and the per-family member counts. Nothing in the
-- database can answer that today. campaign_roster_counts() is per campaign, and a phone sits in
-- several campaigns (the hand-made STEVIC sets are 20 separate campaigns sharing a name prefix),
-- so summing it double-counts. Computing it in the route means paging campaign_numbers_v2 and
-- deduping in JS: ~26.6k rows, 27 sequential .range() round-trips. The 2026-08-05 roster RPC
-- measured exactly that shape at 2.89s for the roster leg alone and concluded "the cost is
-- ROUND-TRIP COUNT, not query cost — which is why the fix is one GROUP BY". Same conclusion here.
--
-- SHAPE: takes the campaign ids and returns ONE row. The route decides which campaigns form a
-- lane using the app's OWN brand and country parsers (campaignDisplay.ts), so this function never
-- reimplements them and cannot drift from the rest of the console. That is deliberate: the
-- country is parsed out of the campaign NAME in TypeScript, and a second parser in SQL would be
-- a silent divergence waiting to happen.
--
-- DEFINITIONS ARE COPIED, NOT INVENTED. Every predicate below is lifted verbatim from
-- 2026-08-04_dashboard_rollup_rpc.sql so the Audience tab and the dashboard can never disagree:
--   connected      status IN ('completed','answered')
--   spoke (reach)  the rollup's `reach` bucket set: positive, declined, early_hangup, neutral
--   texted         the rollup's Sent definition: status IN ('sent','delivered')
-- ⚠ `spoke_lean` is therefore the LEAN definition — no transcript. The mockup's "Spoke with a
-- person" used the TRANSCRIPT classifier, which SQL cannot run (silent_pickup needs user-turn
-- counts, and voicemail detection has a measured 8.8% false-negative rate). The two numbers are
-- NOT interchangeable and the column name says so. Show it as the lean count with that
-- disclosure, or take the figure from the snapshot engine, but never label one as the other.
--
-- Message-level fate rides along (the thin bar under the Texted row) so the card needs one call,
-- not two. Prod's real status values, counted 2026-09-04: delivered 5,909 · sent 906 ·
-- failed 375 · undelivered 305. "Unconfirmed" is `sent`: dispatched, no receipt back from
-- Mobivate. failed + undelivered are both failures; splitting them would imply we can act on the
-- difference, and we cannot.
--
-- Ghost + test campaigns are excluded here as well as in the caller. The route already filters
-- them, but a future caller that forgets would otherwise put internal traffic into a reporting
-- surface, and the guard costs nothing.
--
-- No SECURITY DEFINER, no explicit GRANT — matches the dashboard_call_rollup /
-- dashboard_sms_rollup / campaign_roster_counts precedent. Output is aggregate counts only,
-- strictly less sensitive than what those three already return.
-- No new index: the joins ride existing FK indexes and the row counts are in the tens of
-- thousands; re-measure before adding one.
-- Safe to re-run (DROP-then-CREATE; a RETURNS TABLE shape change would reject
-- CREATE OR REPLACE with 42P13).
--
-- VERIFICATION BEFORE THIS IS TRUSTED: scratchpad q-lane-reach-expected.cjs computes the same
-- counts in JS by paging the rows for one lane. Apply this, call it for that lane, and the two
-- must agree exactly. Do not wire the card until they do.

DROP FUNCTION IF EXISTS public.audience_lane_reach(uuid[]);
CREATE FUNCTION public.audience_lane_reach(p_campaign_ids uuid[])
RETURNS TABLE (
  members int,
  dialled int,
  spoke_lean int,
  texted int,
  text_delivered int,
  texted_not_spoken int,
  msgs int,
  msgs_delivered int,
  msgs_failed int,
  msgs_unconfirmed int
)
LANGUAGE sql STABLE AS $$
  WITH scope AS (
    SELECT n.id AS number_id, n.phone_e164
    FROM public.campaign_numbers_v2 n
    JOIN public.campaigns_v2 cp
      ON cp.id = n.campaign_id
     AND cp.source IS DISTINCT FROM 'ghost_portal'
     AND cp.is_test IS NOT TRUE
    WHERE n.campaign_id = ANY(p_campaign_ids)
      AND n.phone_e164 IS NOT NULL
  ),
  -- Each channel is folded to ONE row per number BEFORE the join. Joining calls and texts to
  -- scope in the same step multiplies them (a number with 3 calls and 2 texts becomes 6 rows).
  -- BOOL_OR would still return the right answer over the multiplied set, which is exactly what
  -- makes that shape dangerous: it is silently correct now and quietly expensive later.
  calls_agg AS (
    SELECT
      c.campaign_number_id AS number_id,
      TRUE AS was_dialled,
      BOOL_OR(
        c.status IN ('completed','answered')
        AND NOT (c.voicemail IS TRUE AND c.goal_reached IS NOT TRUE)
      ) AS spoke
    FROM public.calls_v2 c
    WHERE c.campaign_number_id IN (SELECT number_id FROM scope)
    GROUP BY c.campaign_number_id
  ),
  sms_agg AS (
    SELECT
      m.campaign_number_id AS number_id,
      BOOL_OR(m.status IN ('sent','delivered')) AS was_texted,
      BOOL_OR(m.status = 'delivered')           AS text_landed
    FROM public.sms_messages_v2 m
    WHERE m.campaign_number_id IN (SELECT number_id FROM scope)
    GROUP BY m.campaign_number_id
  ),
  -- One row per PLAYER (phone): a phone can hold several numbers across the campaigns in scope.
  per_player AS (
    SELECT
      s.phone_e164,
      COALESCE(BOOL_OR(ca.was_dialled), FALSE) AS was_dialled,
      COALESCE(BOOL_OR(ca.spoke), FALSE)       AS spoke,
      COALESCE(BOOL_OR(sa.was_texted), FALSE)  AS was_texted,
      COALESCE(BOOL_OR(sa.text_landed), FALSE) AS text_landed
    FROM scope s
    LEFT JOIN calls_agg ca ON ca.number_id = s.number_id
    LEFT JOIN sms_agg  sa ON sa.number_id = s.number_id
    GROUP BY s.phone_e164
  ),
  -- Message-level fate, counted in TEXTS not people.
  fate AS (
    SELECT
      COUNT(*)::int                                                       AS msgs,
      COUNT(*) FILTER (WHERE m.status = 'delivered')::int                 AS msgs_delivered,
      COUNT(*) FILTER (WHERE m.status IN ('failed','undelivered'))::int    AS msgs_failed,
      COUNT(*) FILTER (WHERE m.status = 'sent')::int                      AS msgs_unconfirmed
    FROM public.sms_messages_v2 m
    WHERE m.campaign_number_id IN (SELECT number_id FROM scope)
  )
  SELECT
    COUNT(*)::int                                                         AS members,
    COUNT(*) FILTER (WHERE was_dialled)::int                              AS dialled,
    COUNT(*) FILTER (WHERE spoke)::int                                    AS spoke_lean,
    COUNT(*) FILTER (WHERE was_texted)::int                               AS texted,
    COUNT(*) FILTER (WHERE text_landed)::int                              AS text_delivered,
    COUNT(*) FILTER (WHERE was_texted AND NOT spoke)::int                 AS texted_not_spoken,
    (SELECT msgs FROM fate), (SELECT msgs_delivered FROM fate),
    (SELECT msgs_failed FROM fate), (SELECT msgs_unconfirmed FROM fate)
  FROM per_player;
$$;
