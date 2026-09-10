-- 2026-09-10 Audience: the money strip and the Deposits-by-day chart follow the Depositors table's
-- filters (Jasiel 2026-09-10, after reading EUR 24,656 above a 19-row table: "a number beside a filter
-- should obey it"). Apply in one paste. Re-runnable.
--
-- WHY. The strip was the whole window for every contacted player, while Deposited / Contact / Family
-- and the search shaped only the table beneath it. Filter to "Spoke with them" and 142 depositors'
-- money still sat above 19 rows. This function gives the strip the SAME population as the table.
--
-- WHAT IT RETURNS. Three grains in one call, so the route makes one round trip:
--   grain = 'day'       one row per UTC day: deposits, distinct players, EUR, deposits_before
--   grain = 'currency'  one row per currency: deposits, distinct players, local amount, EUR, before
--   grain = 'total'     one row: deposits, DISTINCT DEPOSITORS across currencies, local, EUR, before
-- The day and currency grains carry exactly the columns audience_lane_deposits and
-- audience_lane_deposit_totals return today, because with every filter at 'any' this function MUST
-- equal both of them to the row. That is the known-good gate (scripts/_gate-0910-deposit-rollup.cjs).
--
-- THE POPULATION is the players query's (audience_lane_players v4), copied verbatim through `owner`:
-- the same lean `reached`, the same strict `spoke_with`, the same texted/delivered, the same family
-- membership, the same search, the same phone-per-CRM-identity rule, so a deposit is never counted
-- for two players and "Spoke with them" means the same thing above and below the line.
--
-- THE MONEY RULE is the strip's own and does not change: deposits DATED inside [p_from, p_to), counted
-- as after-contact when at or after the player's first call or text, however long ago that was. The
-- filters decide WHOSE deposits; the window decides WHICH deposits. Two deliberate consequences:
--   * p_contact / p_family_ids / p_q narrow the players. At 'any' / NULL nothing is narrowed.
--   * p_deposited is the table's LIFETIME ladder (after / before / none / unknown), applied to the
--     players. 'after' keeps players with an after-contact deposit inside the window, which is the
--     strip's own depositors, so the strip does not change. 'before', 'none' and 'unknown' keep
--     players who by definition have no after-contact deposit, so the strip honestly reads zero
--     deposits (and, for 'before', a "more before contact, not counted" line). That is the filter
--     being obeyed, not a fault.
-- The table's OWN row-window rule ("last contact inside the window" for non-depositor filters) is
-- NOT applied here: it decides which players are listed, not whose money is in the window.
--
-- PERFORMANCE. Same shape as the siblings; enable_nestloop off so the planner hashes the CTE joins.
-- Measure after applying (the gate times All brands over All time; the siblings do it in under a second).
--
-- Verify after applying:  node scripts/_gate-0910-deposit-rollup.cjs   (all four parts must be green)

DROP FUNCTION IF EXISTS public.audience_lane_deposit_rollup(uuid[], timestamptz, timestamptz, text, text, uuid[], text);
CREATE FUNCTION public.audience_lane_deposit_rollup(
  p_campaign_ids uuid[],
  p_from timestamptz,
  p_to timestamptz,
  p_deposited text,
  p_contact text,
  p_family_ids uuid[],
  p_q text
)
RETURNS TABLE (
  grain text,
  day date,
  currency text,
  deposits int,
  players int,
  amount_local numeric,
  amount_eur numeric,
  deposits_before int
)
LANGUAGE sql STABLE AS $$
  WITH scope AS (
    SELECT n.id AS number_id, n.phone_e164, n.cio_id, n.display_name, n.campaign_id,
           (n.outcome = 'declined_offer') AS declined,
           COALESCE(cp.cio_workspace, 'lucky7even') AS workspace
    FROM public.campaign_numbers_v2 n
    JOIN public.campaigns_v2 cp
      ON cp.id = n.campaign_id
     AND cp.source IS DISTINCT FROM 'ghost_portal'
     AND cp.is_test IS NOT TRUE
    WHERE n.campaign_id = ANY(p_campaign_ids)
      AND n.phone_e164 IS NOT NULL
  ),
  calls_agg AS (
    SELECT c.campaign_number_id AS number_id,
           COUNT(*)::int AS calls,
           MIN(c.created_at) AS first_call, MAX(c.created_at) AS last_call,
           BOOL_OR(c.status IN ('completed','answered') AND NOT (c.voicemail IS TRUE AND c.goal_reached IS NOT TRUE)) AS reached,
           BOOL_OR(public.voizo_spoke_with(c.status, c.voicemail, c.goal_reached, c.duration_seconds,
                                           c.ended_reason, c.transcript, s.declined)) AS spoke_with
    FROM public.calls_v2 c
    JOIN scope s ON s.number_id = c.campaign_number_id
    GROUP BY c.campaign_number_id
  ),
  sms_agg AS (
    SELECT m.campaign_number_id AS number_id,
           MIN(m.created_at) AS first_sms, MAX(m.created_at) AS last_sms,
           BOOL_OR(m.status IN ('sent','delivered')) AS texted,
           BOOL_OR(m.status = 'delivered') AS delivered
    FROM public.sms_messages_v2 m
    WHERE m.campaign_number_id IN (SELECT number_id FROM scope)
    GROUP BY m.campaign_number_id
  ),
  per_number AS (
    SELECT s.phone_e164, s.campaign_id, s.display_name,
           LEAST(ca.first_call, sa.first_sms) AS first_at,
           COALESCE(ca.reached, FALSE) AS reached,
           COALESCE(ca.spoke_with, FALSE) AS spoke_with,
           COALESCE(sa.texted, FALSE) AS texted,
           COALESCE(sa.delivered, FALSE) AS delivered,
           (p_family_ids IS NULL OR s.campaign_id = ANY(p_family_ids)) AS in_family
    FROM scope s
    LEFT JOIN calls_agg ca ON ca.number_id = s.number_id
    LEFT JOIN sms_agg  sa ON sa.number_id = s.number_id
  ),
  per_player AS (
    SELECT pn.phone_e164,
           MAX(pn.display_name) AS display_name,
           MIN(pn.first_at) AS first_at,
           BOOL_OR(pn.reached) AS reached,
           BOOL_OR(pn.spoke_with) AS spoke_with,
           BOOL_OR(pn.texted) AS texted,
           BOOL_OR(pn.delivered) AS delivered,
           BOOL_OR(pn.in_family) AS in_family
    FROM per_number pn
    GROUP BY pn.phone_e164
  ),
  identity AS (
    SELECT s.workspace, s.cio_id, s.phone_e164 FROM scope s WHERE s.cio_id IS NOT NULL
    UNION
    SELECT s.workspace, rs.cio_id, s.phone_e164
    FROM scope s
    JOIN public.realtime_seen_members rs ON rs.phone_e164 = s.phone_e164
    JOIN public.campaigns_v2 pc ON pc.id = rs.parent_campaign_id
     AND COALESCE(pc.cio_workspace, 'lucky7even') = s.workspace
  ),
  owner AS (
    SELECT i.workspace, i.cio_id, MIN(i.phone_e164) AS phone_e164
    FROM identity i
    GROUP BY i.workspace, i.cio_id
  ),
  -- WHOSE money: the players the table's Contact, Family and search would keep. No window here.
  pop AS (
    SELECT pp.*
    FROM per_player pp
    WHERE pp.in_family
      AND (p_q IS NULL OR p_q = '' OR pp.phone_e164 ILIKE '%' || p_q || '%' OR pp.display_name ILIKE '%' || p_q || '%')
      AND CASE p_contact
            WHEN 'reached'     THEN pp.reached
            WHEN 'spoke'       THEN pp.spoke_with
            WHEN 'never_spoke' THEN NOT pp.spoke_with
            WHEN 'texted'      THEN pp.texted
            WHEN 'delivered'   THEN pp.delivered
            WHEN 'never'       THEN NOT pp.reached
            ELSE TRUE
          END
  ),
  -- Every deposit of those players, lifetime, with the two flags the ladder and the strip need.
  dep_all AS (
    SELECT o.phone_e164, e.occurred_at, e.currency, e.amount_norm,
           CASE WHEN e.amount_local ~ '^-?[0-9]+(\.[0-9]+)?$' THEN e.amount_local::numeric END AS amount_local,
           (e.occurred_at >= p.first_at) AS after_contact,
           (e.occurred_at >= p_from AND e.occurred_at < p_to) AS in_window
    FROM public.cio_events e
    JOIN owner o ON o.cio_id = e.cio_id AND o.workspace = e.workspace
    JOIN pop p ON p.phone_e164 = o.phone_e164
    WHERE e.event_name = 'deposit_made'
  ),
  -- The table's Deposited ladder, per player, on the same lifetime facts the table uses.
  state AS (
    SELECT p.phone_e164,
           EXISTS (SELECT 1 FROM identity i WHERE i.phone_e164 = p.phone_e164) AS cio_known,
           COUNT(d.phone_e164) FILTER (WHERE d.after_contact)                       AS dep_after,
           COUNT(d.phone_e164) FILTER (WHERE d.after_contact IS NOT TRUE)           AS dep_before,
           COUNT(d.phone_e164) FILTER (WHERE d.after_contact AND d.in_window)       AS dep_after_in_window
    FROM pop p
    LEFT JOIN dep_all d ON d.phone_e164 = p.phone_e164
    GROUP BY p.phone_e164
  ),
  kept AS (
    SELECT s.phone_e164
    FROM state s
    WHERE CASE p_deposited
            WHEN 'after'   THEN s.dep_after_in_window > 0
            WHEN 'before'  THEN s.dep_after = 0 AND s.dep_before > 0
            WHEN 'none'    THEN s.cio_known AND s.dep_after = 0 AND s.dep_before = 0
            WHEN 'unknown' THEN NOT s.cio_known
            ELSE TRUE
          END
  ),
  -- WHICH money: the kept players' deposits dated inside the window. The strip's rule, unchanged.
  dep AS (
    SELECT d.phone_e164, d.occurred_at, d.currency, d.amount_norm, d.amount_local, d.after_contact
    FROM dep_all d
    JOIN kept k ON k.phone_e164 = d.phone_e164
    WHERE d.in_window
  )
  SELECT 'day'::text                                                              AS grain,
         (d.occurred_at AT TIME ZONE 'UTC')::date                                 AS day,
         NULL::text                                                               AS currency,
         COUNT(*) FILTER (WHERE d.after_contact)::int                             AS deposits,
         COUNT(DISTINCT d.phone_e164) FILTER (WHERE d.after_contact)::int         AS players,
         NULL::numeric                                                            AS amount_local,
         COALESCE(SUM(d.amount_norm) FILTER (WHERE d.after_contact), 0)           AS amount_eur,
         COUNT(*) FILTER (WHERE d.after_contact IS NOT TRUE)::int                 AS deposits_before
  FROM dep d
  GROUP BY 2
  UNION ALL
  SELECT 'currency', NULL, COALESCE(d.currency, '?'),
         COUNT(*) FILTER (WHERE d.after_contact)::int,
         COUNT(DISTINCT d.phone_e164) FILTER (WHERE d.after_contact)::int,
         COALESCE(SUM(d.amount_local) FILTER (WHERE d.after_contact), 0),
         COALESCE(SUM(d.amount_norm)  FILTER (WHERE d.after_contact), 0),
         COUNT(*) FILTER (WHERE d.after_contact IS NOT TRUE)::int
  FROM dep d
  GROUP BY 3
  UNION ALL
  SELECT 'total', NULL, NULL,
         COUNT(*) FILTER (WHERE d.after_contact)::int,
         COUNT(DISTINCT d.phone_e164) FILTER (WHERE d.after_contact)::int,
         COALESCE(SUM(d.amount_local) FILTER (WHERE d.after_contact), 0),
         COALESCE(SUM(d.amount_norm)  FILTER (WHERE d.after_contact), 0),
         COUNT(*) FILTER (WHERE d.after_contact IS NOT TRUE)::int
  FROM dep d
  ORDER BY 1, 2, 7 DESC;
$$;
ALTER FUNCTION public.audience_lane_deposit_rollup(uuid[], timestamptz, timestamptz, text, text, uuid[], text) SET enable_nestloop = off;

-- ── Rollback ────────────────────────────────────────────────────────────────────────────────
-- DROP FUNCTION IF EXISTS public.audience_lane_deposit_rollup(uuid[], timestamptz, timestamptz, text, text, uuid[], text);
-- The page then reads "Not available yet" on the strip and names this file; nothing else is affected.
