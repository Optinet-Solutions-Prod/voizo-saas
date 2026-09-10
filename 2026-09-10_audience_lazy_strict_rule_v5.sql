-- 2026-09-10 (evening) — the strict "Spoke with them" rule runs only when asked for.
-- Apply in one paste, re-runnable. Replaces audience_lane_players v4 and audience_lane_deposit_rollup v1.
--
-- WHY. v4 (this afternoon) computed voizo_spoke_with() over EVERY call in the lane on EVERY call of the
-- function, and the rollup did the same, so a page load ran the transcript regex across ~27,000
-- transcripts twice, beside the reach route's 45 statements. Under that load the players statement
-- crossed the 8 s limit and the Depositors table 500'd on three loads out of five (measured, 20:10 UTC).
--
-- WHAT CHANGES. Nothing in any answer. Only WHEN the strict rule is evaluated:
--   * players:  the lane-wide pass runs only for p_contact IN ('spoke','never_spoke'), where the filter
--               itself needs every player's verdict. For every other filter the returned PAGE (p_limit
--               rows) gets its verdict from a per-player subquery over that player's own calls, so the
--               `spoke_with` column and the CSV export read exactly as before. The eager and lazy paths
--               must agree on every row; scripts/_gate-0910-lazy-strict-rule.cjs proves it.
--   * rollup:   the strict rule runs only for the two contact filters that read it; the Deposited ladder's
--               lifetime deposit scan and the CRM-identity check run only for the values that need them.
--               With every filter at any it stays equal to the old functions to the row (the rollup gate).
--
-- Paging moved into a ROW_NUMBER() over the same six sort keys, so the per-row subquery is evaluated for
-- the page's rows only. Order is unchanged: the window's ORDER BY is the v3/v4 ORDER BY verbatim.
--
-- Verify after applying, in this order:
--   node scripts/_gate-0910-lazy-strict-rule.cjs      -- lazy page verdicts == eager membership, every row
--   node scripts/_gate-0910-strict-reached.cjs        -- part 2 still EXACT (voizo_spoke_with untouched)
--   node scripts/_gate-0910-deposit-rollup.cjs        -- still all green
--   node scratchpad/q-lane-players-recon.cjs          -- lean rule and paging still EXACT

-- ── 1. audience_lane_players v5 ──────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.audience_lane_players(uuid[], timestamptz, timestamptz, text, text, uuid[], text, text, text, int, int, int);
CREATE FUNCTION public.audience_lane_players(
  p_campaign_ids uuid[],
  p_from timestamptz,
  p_to timestamptz,
  p_deposited text,
  p_contact text,
  p_family_ids uuid[],
  p_q text,
  p_sort text,
  p_dir text,
  p_limit int,
  p_offset int,
  p_attrib_days int DEFAULT 0
)
RETURNS TABLE (
  phone_e164 text,
  display_name text,
  last_campaign_id uuid,
  first_at timestamptz,
  last_at timestamptz,
  calls int,
  reached boolean,
  spoke_with boolean,
  texted boolean,
  delivered boolean,
  cio_known boolean,
  dep_after int,
  dep_after_eur numeric,
  dep_before int,
  first_dep_after_at timestamptz,
  last_dep_at timestamptz,
  dep_after_in_window int,
  dep_after_in_window_eur numeric,
  total_count bigint
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
           -- The strict rule over the WHOLE lane only when the filter needs every verdict. NULL
           -- otherwise: the page's rows get theirs from the per-player subquery at the end.
           CASE WHEN p_contact IN ('spoke','never_spoke')
                THEN BOOL_OR(public.voizo_spoke_with(c.status, c.voicemail, c.goal_reached, c.duration_seconds,
                                                     c.ended_reason, c.transcript, s.declined))
                ELSE NULL END AS spoke_with
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
           COALESCE(ca.calls, 0) AS calls,
           LEAST(ca.first_call, sa.first_sms) AS first_at,
           GREATEST(ca.last_call, sa.last_sms) AS last_at,
           COALESCE(ca.reached, FALSE) AS reached,
           ca.spoke_with,
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
           (ARRAY_AGG(pn.campaign_id ORDER BY pn.last_at DESC NULLS LAST))[1] AS last_campaign_id,
           MIN(pn.first_at) AS first_at,
           MAX(pn.last_at) AS last_at,
           SUM(pn.calls)::int AS calls,
           BOOL_OR(pn.reached) AS reached,
           BOOL_OR(pn.spoke_with) AS spoke_with,   -- NULL on the lazy path
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
  dep_win AS (
    SELECT o.phone_e164
    FROM public.cio_events e
    JOIN owner o ON o.cio_id = e.cio_id AND o.workspace = e.workspace
    JOIN per_player pp ON pp.phone_e164 = o.phone_e164
    WHERE e.event_name = 'deposit_made'
      AND e.occurred_at >= p_from AND e.occurred_at < p_to
      AND e.occurred_at >= pp.first_at
      AND (COALESCE(p_attrib_days, 0) <= 0
           OR e.occurred_at < pp.first_at + make_interval(days => p_attrib_days))
    GROUP BY o.phone_e164
  ),
  cand AS (
    SELECT pp.*
    FROM per_player pp
    WHERE pp.in_family
      AND (p_q IS NULL OR p_q = '' OR pp.phone_e164 ILIKE '%' || p_q || '%' OR pp.display_name ILIKE '%' || p_q || '%')
      AND CASE p_contact
            WHEN 'reached'     THEN pp.reached
            WHEN 'spoke'       THEN COALESCE(pp.spoke_with, FALSE)
            WHEN 'never_spoke' THEN NOT COALESCE(pp.spoke_with, FALSE)
            WHEN 'texted'      THEN pp.texted
            WHEN 'delivered'   THEN pp.delivered
            WHEN 'never'       THEN NOT pp.reached
            ELSE TRUE
          END
      AND CASE WHEN p_deposited = 'after'
            THEN pp.phone_e164 IN (SELECT dw.phone_e164 FROM dep_win dw)
            ELSE pp.last_at >= p_from AND pp.last_at < p_to
          END
  ),
  known AS (
    SELECT DISTINCT i.phone_e164 FROM identity i WHERE i.phone_e164 IN (SELECT c.phone_e164 FROM cand c)
  ),
  dep AS (
    SELECT o.phone_e164, e.occurred_at, e.amount_norm,
           (e.occurred_at >= c.first_at
            AND (COALESCE(p_attrib_days, 0) <= 0
                 OR e.occurred_at < c.first_at + make_interval(days => p_attrib_days))) AS after_contact,
           (e.occurred_at >= p_from AND e.occurred_at < p_to) AS in_window
    FROM public.cio_events e
    JOIN owner o ON o.cio_id = e.cio_id AND o.workspace = e.workspace
    JOIN cand c ON c.phone_e164 = o.phone_e164
    WHERE e.event_name = 'deposit_made'
  ),
  dep_agg AS (
    SELECT d.phone_e164,
           COUNT(*) FILTER (WHERE d.after_contact)::int AS dep_after,
           COALESCE(SUM(d.amount_norm) FILTER (WHERE d.after_contact), 0) AS dep_after_eur,
           COUNT(*) FILTER (WHERE d.after_contact IS NOT TRUE)::int AS dep_before,
           MIN(d.occurred_at) FILTER (WHERE d.after_contact) AS first_dep_after_at,
           MAX(d.occurred_at) AS last_dep_at,
           COUNT(*) FILTER (WHERE d.after_contact AND d.in_window)::int AS dep_after_in_window,
           COALESCE(SUM(d.amount_norm) FILTER (WHERE d.after_contact AND d.in_window), 0) AS dep_after_in_window_eur
    FROM dep d
    GROUP BY d.phone_e164
  ),
  rows_all AS (
    SELECT c.phone_e164, c.display_name, c.last_campaign_id, c.first_at, c.last_at, c.calls,
           c.reached, c.spoke_with, c.texted, c.delivered,
           (k.phone_e164 IS NOT NULL) AS cio_known,
           COALESCE(da.dep_after, 0) AS dep_after,
           COALESCE(da.dep_after_eur, 0) AS dep_after_eur,
           COALESCE(da.dep_before, 0) AS dep_before,
           da.first_dep_after_at,
           da.last_dep_at,
           COALESCE(da.dep_after_in_window, 0) AS dep_after_in_window,
           COALESCE(da.dep_after_in_window_eur, 0) AS dep_after_in_window_eur
    FROM cand c
    LEFT JOIN known k ON k.phone_e164 = c.phone_e164
    LEFT JOIN dep_agg da ON da.phone_e164 = c.phone_e164
  ),
  filtered AS (
    SELECT r.*
    FROM rows_all r
    WHERE CASE p_deposited
            WHEN 'after'   THEN r.dep_after_in_window > 0
            WHEN 'before'  THEN r.dep_after = 0 AND r.dep_before > 0
            WHEN 'none'    THEN r.cio_known AND r.dep_after = 0 AND r.dep_before = 0
            WHEN 'unknown' THEN NOT r.cio_known
            ELSE TRUE
          END
  ),
  -- The v3/v4 ORDER BY, verbatim, as a row number, so the page can be cut BEFORE the per-row
  -- strict-rule subquery below runs. NULLs last both ways; phone is the tiebreak in p_dir's order.
  paged AS (
    SELECT f.*,
           COUNT(*) OVER () AS total_count,
           ROW_NUMBER() OVER (ORDER BY
             CASE WHEN p_dir = 'asc' THEN
               CASE p_sort WHEN 'first_contact' THEN f.first_at WHEN 'last_deposit' THEN f.last_dep_at WHEN 'first_deposit' THEN f.first_dep_after_at
                           WHEN 'amount' THEN NULL WHEN 'calls' THEN NULL WHEN 'lag' THEN NULL WHEN 'phone' THEN NULL ELSE f.last_at END
             END ASC NULLS LAST,
             CASE WHEN p_dir IS DISTINCT FROM 'asc' THEN
               CASE p_sort WHEN 'first_contact' THEN f.first_at WHEN 'last_deposit' THEN f.last_dep_at WHEN 'first_deposit' THEN f.first_dep_after_at
                           WHEN 'amount' THEN NULL WHEN 'calls' THEN NULL WHEN 'lag' THEN NULL WHEN 'phone' THEN NULL ELSE f.last_at END
             END DESC NULLS LAST,
             CASE WHEN p_dir = 'asc' THEN
               CASE p_sort WHEN 'amount' THEN f.dep_after_eur WHEN 'calls' THEN f.calls::numeric
                           WHEN 'lag' THEN EXTRACT(EPOCH FROM (f.first_dep_after_at - f.first_at)) END
             END ASC NULLS LAST,
             CASE WHEN p_dir IS DISTINCT FROM 'asc' THEN
               CASE p_sort WHEN 'amount' THEN f.dep_after_eur WHEN 'calls' THEN f.calls::numeric
                           WHEN 'lag' THEN EXTRACT(EPOCH FROM (f.first_dep_after_at - f.first_at)) END
             END DESC NULLS LAST,
             CASE WHEN p_dir = 'asc' THEN f.phone_e164 END ASC,
             CASE WHEN p_dir IS DISTINCT FROM 'asc' THEN f.phone_e164 END DESC
           ) AS rn
    FROM filtered f
  )
  SELECT p.phone_e164, p.display_name, p.last_campaign_id, p.first_at, p.last_at, p.calls,
         p.reached,
         -- Eager path: the lane-wide verdict. Lazy path: this player's own calls, for the page only.
         -- Same scope rules as calls_agg (lane numbers, no ghost or test campaigns, the contact's
         -- declined flag), so the two paths cannot disagree.
         COALESCE(
           p.spoke_with,
           (SELECT BOOL_OR(public.voizo_spoke_with(c.status, c.voicemail, c.goal_reached, c.duration_seconds,
                                                   c.ended_reason, c.transcript, (n.outcome = 'declined_offer')))
              FROM public.campaign_numbers_v2 n
              JOIN public.campaigns_v2 cp ON cp.id = n.campaign_id
               AND cp.source IS DISTINCT FROM 'ghost_portal' AND cp.is_test IS NOT TRUE
              JOIN public.calls_v2 c ON c.campaign_number_id = n.id
             WHERE n.phone_e164 = p.phone_e164
               AND n.campaign_id = ANY(p_campaign_ids)),
           FALSE) AS spoke_with,
         p.texted, p.delivered, p.cio_known,
         p.dep_after, p.dep_after_eur, p.dep_before, p.first_dep_after_at, p.last_dep_at,
         p.dep_after_in_window, p.dep_after_in_window_eur,
         p.total_count
  FROM paged p
  WHERE p.rn > p_offset AND p.rn <= p_offset + p_limit
  ORDER BY p.rn;
$$;
ALTER FUNCTION public.audience_lane_players(uuid[], timestamptz, timestamptz, text, text, uuid[], text, text, text, int, int, int) SET enable_nestloop = off;

-- ── 2. audience_lane_deposit_rollup v2 ───────────────────────────────────────────────────────
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
           BOOL_OR(c.status IN ('completed','answered') AND NOT (c.voicemail IS TRUE AND c.goal_reached IS NOT TRUE)) AS reached,
           -- Only the two contact filters read the strict rule; nothing else pays for it.
           CASE WHEN p_contact IN ('spoke','never_spoke')
                THEN BOOL_OR(public.voizo_spoke_with(c.status, c.voicemail, c.goal_reached, c.duration_seconds,
                                                     c.ended_reason, c.transcript, s.declined))
                ELSE FALSE END AS spoke_with
    FROM public.calls_v2 c
    JOIN scope s ON s.number_id = c.campaign_number_id
    GROUP BY c.campaign_number_id
  ),
  sms_agg AS (
    SELECT m.campaign_number_id AS number_id,
           BOOL_OR(m.status IN ('sent','delivered')) AS texted,
           BOOL_OR(m.status = 'delivered') AS delivered
    FROM public.sms_messages_v2 m
    WHERE m.campaign_number_id IN (SELECT number_id FROM scope)
    GROUP BY m.campaign_number_id
  ),
  calls_first AS (
    SELECT c.campaign_number_id AS number_id, MIN(c.created_at) AS at
    FROM public.calls_v2 c WHERE c.campaign_number_id IN (SELECT number_id FROM scope)
    GROUP BY c.campaign_number_id
  ),
  sms_first AS (
    SELECT m.campaign_number_id AS number_id, MIN(m.created_at) AS at
    FROM public.sms_messages_v2 m WHERE m.campaign_number_id IN (SELECT number_id FROM scope)
    GROUP BY m.campaign_number_id
  ),
  per_number AS (
    SELECT s.phone_e164, s.campaign_id, s.display_name,
           LEAST(cf.at, sf.at) AS first_at,
           COALESCE(ca.reached, FALSE) AS reached,
           COALESCE(ca.spoke_with, FALSE) AS spoke_with,
           COALESCE(sa.texted, FALSE) AS texted,
           COALESCE(sa.delivered, FALSE) AS delivered,
           (p_family_ids IS NULL OR s.campaign_id = ANY(p_family_ids)) AS in_family
    FROM scope s
    LEFT JOIN calls_agg  ca ON ca.number_id = s.number_id
    LEFT JOIN sms_agg    sa ON sa.number_id = s.number_id
    LEFT JOIN calls_first cf ON cf.number_id = s.number_id
    LEFT JOIN sms_first   sf ON sf.number_id = s.number_id
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
  -- The Deposited ladder needs LIFETIME deposits; the strip needs only the window's. Pull lifetime
  -- rows only when a ladder value is set, so the default page load reads the window alone.
  dep_all AS (
    SELECT o.phone_e164, e.occurred_at, e.currency, e.amount_norm,
           CASE WHEN e.amount_local ~ '^-?[0-9]+(\.[0-9]+)?$' THEN e.amount_local::numeric END AS amount_local,
           (e.occurred_at >= p.first_at) AS after_contact,
           (e.occurred_at >= p_from AND e.occurred_at < p_to) AS in_window
    FROM public.cio_events e
    JOIN owner o ON o.cio_id = e.cio_id AND o.workspace = e.workspace
    JOIN pop p ON p.phone_e164 = o.phone_e164
    WHERE e.event_name = 'deposit_made'
      AND (p_deposited IN ('after','before','none','unknown')
           OR (e.occurred_at >= p_from AND e.occurred_at < p_to))
  ),
  state AS (
    SELECT p.phone_e164,
           CASE WHEN p_deposited IN ('none','unknown')
                THEN EXISTS (SELECT 1 FROM identity i WHERE i.phone_e164 = p.phone_e164)
                ELSE TRUE END                                                          AS cio_known,
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
  dep AS (
    SELECT d.phone_e164, d.occurred_at, d.currency, d.amount_norm, d.amount_local, d.after_contact
    FROM dep_all d
    JOIN kept k ON k.phone_e164 = d.phone_e164
    WHERE d.in_window
  )
  SELECT 'day'::text, (d.occurred_at AT TIME ZONE 'UTC')::date, NULL::text,
         COUNT(*) FILTER (WHERE d.after_contact)::int,
         COUNT(DISTINCT d.phone_e164) FILTER (WHERE d.after_contact)::int,
         NULL::numeric,
         COALESCE(SUM(d.amount_norm) FILTER (WHERE d.after_contact), 0),
         COUNT(*) FILTER (WHERE d.after_contact IS NOT TRUE)::int
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
-- Re-apply 2026-09-10_audience_lane_players_v4_strict_reached.sql (section 4) and
-- 2026-09-10_audience_lane_deposit_rollup_rpc.sql. Answers are identical; only the cost differs.
