-- 2026-09-10 (evening) — v5b: the strict rule's path is chosen by page size too. Apply in one paste.
-- Replaces ONLY audience_lane_players; audience_lane_deposit_rollup v2 stays as pasted.
--
-- v5 made the strict rule lazy: per player for the rows on screen unless the Contact filter needs
-- every verdict. Right for a 25-row page, wrong for the CSV export, whose 1,000-row pages ran one
-- per-player scan per row and crossed the 8 s statement limit (674 rows, 8.4 s, 20:40 UTC). One
-- condition fixes it: above 100 rows the single lane-wide pass is the cheaper path. Answers are
-- identical on both paths, which scripts/_gate-0910-lazy-strict-rule.cjs proves row by row and then
-- through the export itself.
--
-- Verify after applying:
--   node scripts/_gate-0910-lazy-strict-rule.cjs      -- all four parts, incl. the CSV export
--   node scratchpad/q-lane-players-recon.cjs          -- lean rule and paging still EXACT

-- ── audience_lane_players v5b (the rollup v2 is unchanged and is NOT in this file) ──────────────────────────────────────────────────────────────
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
           -- ...and ALSO for an export-sized page. v5's lazy per-row subquery is cheaper than the
           -- lane pass for 25 rows and dearer for 1,000: the CSV export (p_limit 1000, 674 rows on
           -- 7d) ran 674 per-player scans and hit the 8 s limit (measured 20:40 UTC). Above 100
           -- rows the one lane-wide pass wins, so the page size chooses the path. Same answers.
           CASE WHEN p_contact IN ('spoke','never_spoke') OR p_limit > 100
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

