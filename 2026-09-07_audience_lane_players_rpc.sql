-- 2026-09-07 Audience lane PLAYERS query + deposit totals per currency — v3, apply in one paste
-- (re-runnable: DROPs the v2 10-argument signature, then CREATE). v3 adds column sorting: p_dir and
-- eight sort keys (Jasiel 2026-09-07: "sorting in the columns"). v1 of the same evening timed out on
-- All brands, see PERFORMANCE.
-- Companions to audience_lane_reach / audience_lane_deposits.
--
-- WHY. The Audience tab's Player activity list was a SAMPLE (the 100 most recently contacted players,
-- enriched in the route). Jasiel wants to find GROUPS of players over the whole lane: who deposited
-- after we contacted them, who was reached, texted, whose text was delivered, in which family, in a
-- window, and to count and export them. A filter over a sample answers for the sample. This function
-- computes one row per PLAYER (phone) over the whole lane in the database, applies the filters, sorts,
-- pages, and returns the true filtered total on every row (COUNT(*) OVER ()).
--
-- SHAPE. Same contract as the other two: the ROUTE picks the campaign ids with the app's own brand and
-- country parsers; a FAMILY filter arrives as the family's campaign ids (p_family_ids), resolved by the
-- route with the tab's own familyKeyOf, so no family rule lives in SQL. Predicates are the dashboard's:
--   reached    a call with status IN ('completed','answered') AND NOT the voicemail bucket (lean rule)
--   texted     an SMS with status IN ('sent','delivered');  delivered  status = 'delivered'
-- Money joins on (workspace, cio_id) through BOTH bridges (campaign_numbers_v2.cio_id, and
-- realtime_seen_members under a same-brand parent), and each CRM identity is attributed to exactly ONE
-- phone (the smallest), so a deposit is never counted for two players; the same rule as
-- audience_lane_deposits. "After contact" = at or after the player's first call or text in the lane.
--
-- THE WINDOW [p_from, p_to) means the event the filter is about (Jasiel 2026-09-07): with
-- p_deposited = 'after' it is the DEPOSIT date (deposits after contact inside the window); for every
-- other value it is the LAST CONTACT date. Deposits by day and the money strip read deposits in the
-- window, so the depositor view and the chart agree.
--
-- FILTERS (text enums, anything else = 'any'):
--   p_deposited  any | after (deposited after contact, in the window) | before (deposited only before
--                contact) | none (CRM record, no deposit ever) | unknown (no CRM record: cannot say)
--   p_contact    any | reached | texted | delivered | never (never reached, dialled or not)
--   p_family_ids NULL = any; else the player holds a number in one of these campaigns
--   p_q          NULL = none; else phone or name contains it (ILIKE)
--   p_sort       last_contact (default) | first_contact | last_deposit | first_deposit | amount (EUR after
--                contact) | lag (first contact to first deposit after it) | calls | phone
--   p_dir        desc (default) | asc. NULLs sort last either way; phone is the tiebreak, in p_dir's order.
--
-- PERFORMANCE (measured 2026-09-07 against prod). v1 joined identities and deposits to EVERY player of
-- the lane and filtered afterwards; the cost tracked the players surviving the contact window before
-- those joins (17 players 0.3 s, 1,602 players 0.9 s, 6,762 players 3.5 s) and All brands (20k players)
-- hit the API's 8 s statement timeout. v2 picks the WINDOW'S CANDIDATES first (last contact in the
-- window, or, under the depositor filter, an after-contact deposit in the window), and only they meet
-- the identity and deposit joins. enable_nestloop is off for this function so the planner hashes the
-- CTE joins instead of looping them (CTE row estimates are what misled it), and realtime_seen_members
-- gets an index on the phone it is joined by.
--
-- No SECURITY DEFINER, no GRANT (same precedent). VERIFICATION BEFORE THIS IS TRUSTED: scratchpad
-- q-lane-players-recon.cjs recounts one lane in JS with the same rules for eight filter combinations
-- and diffs totals AND the row set AND per-row facts, plus the paging and the totals per currency.
-- Exact match required (it was, for v1, on fortuneplay|AU and lucky7even|AU).

CREATE INDEX IF NOT EXISTS realtime_seen_members_phone_idx ON public.realtime_seen_members (phone_e164);

DROP FUNCTION IF EXISTS public.audience_lane_players(uuid[], timestamptz, timestamptz, text, text, uuid[], text, text, int, int);
DROP FUNCTION IF EXISTS public.audience_lane_players(uuid[], timestamptz, timestamptz, text, text, uuid[], text, text, text, int, int);
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
  p_offset int
)
RETURNS TABLE (
  phone_e164 text,
  display_name text,
  last_campaign_id uuid,
  first_at timestamptz,
  last_at timestamptz,
  calls int,
  reached boolean,
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
           BOOL_OR(c.status IN ('completed','answered') AND NOT (c.voicemail IS TRUE AND c.goal_reached IS NOT TRUE)) AS reached
    FROM public.calls_v2 c
    WHERE c.campaign_number_id IN (SELECT number_id FROM scope)
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
  -- one phone per CRM identity, so a deposit lands on exactly one player
  owner AS (
    SELECT i.workspace, i.cio_id, MIN(i.phone_e164) AS phone_e164
    FROM identity i
    GROUP BY i.workspace, i.cio_id
  ),
  -- the depositor filter's candidates: players with an after-contact deposit inside the window
  dep_win AS (
    SELECT o.phone_e164
    FROM public.cio_events e
    JOIN owner o ON o.cio_id = e.cio_id AND o.workspace = e.workspace
    JOIN per_player pp ON pp.phone_e164 = o.phone_e164
    WHERE e.event_name = 'deposit_made'
      AND e.occurred_at >= p_from AND e.occurred_at < p_to
      AND e.occurred_at >= pp.first_at
    GROUP BY o.phone_e164
  ),
  -- THE WINDOW'S CANDIDATES, before any identity or deposit join: last contact in the window, or, under
  -- the depositor filter, an after-contact deposit in the window. Family, search and contact filters
  -- apply here too, so what follows touches hundreds of rows, never the whole lane.
  cand AS (
    SELECT pp.*
    FROM per_player pp
    WHERE pp.in_family
      AND (p_q IS NULL OR p_q = '' OR pp.phone_e164 ILIKE '%' || p_q || '%' OR pp.display_name ILIKE '%' || p_q || '%')
      AND CASE p_contact
            WHEN 'reached'   THEN pp.reached
            WHEN 'texted'    THEN pp.texted
            WHEN 'delivered' THEN pp.delivered
            WHEN 'never'     THEN NOT pp.reached
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
           (e.occurred_at >= c.first_at) AS after_contact,
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
           c.reached, c.texted, c.delivered,
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
  )
  SELECT f.phone_e164, f.display_name, f.last_campaign_id, f.first_at, f.last_at, f.calls,
         f.reached, f.texted, f.delivered, f.cio_known,
         f.dep_after, f.dep_after_eur, f.dep_before, f.first_dep_after_at, f.last_dep_at,
         f.dep_after_in_window, f.dep_after_in_window_eur,
         COUNT(*) OVER () AS total_count
  FROM filtered f
  -- One sort key per type (a timestamp, a number), picked by p_sort; the other type's expression is
  -- NULL for every row and sorts as a no-op. Direction is applied by duplicating each key, one ASC
  -- and one DESC, with the other side NULL. NULLs last both ways: a player with no deposit sits at
  -- the bottom whether the money column is sorted up or down.
  ORDER BY
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
  LIMIT p_limit OFFSET p_offset;
$$;
ALTER FUNCTION public.audience_lane_players(uuid[], timestamptz, timestamptz, text, text, uuid[], text, text, text, int, int) SET enable_nestloop = off;

-- Deposit totals per CURRENCY for the money strip: after-contact deposits inside the window, counted in
-- deposits, distinct players, the local amount (never summed across currencies) and the CRM's
-- EUR-normalised amount beside it; deposits_before = deposits in the window that were NOT after contact.
-- amount_local is stored as text; a non-numeric string counts as NULL rather than failing the call.
-- (Unchanged from v1; 0.8 s for All brands over all time.)
DROP FUNCTION IF EXISTS public.audience_lane_deposit_totals(uuid[], timestamptz, timestamptz);
CREATE FUNCTION public.audience_lane_deposit_totals(p_campaign_ids uuid[], p_from timestamptz, p_to timestamptz)
RETURNS TABLE (
  currency text,
  deposits int,
  players int,
  amount_local numeric,
  amount_eur numeric,
  deposits_before int
)
LANGUAGE sql STABLE AS $$
  WITH scope AS (
    SELECT n.id AS number_id, n.phone_e164, n.cio_id,
           COALESCE(cp.cio_workspace, 'lucky7even') AS workspace
    FROM public.campaign_numbers_v2 n
    JOIN public.campaigns_v2 cp
      ON cp.id = n.campaign_id
     AND cp.source IS DISTINCT FROM 'ghost_portal'
     AND cp.is_test IS NOT TRUE
    WHERE n.campaign_id = ANY(p_campaign_ids)
      AND n.phone_e164 IS NOT NULL
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
  first_contact AS (
    SELECT s.phone_e164, MIN(LEAST(cf.at, sf.at)) AS first_at
    FROM scope s
    LEFT JOIN calls_first cf ON cf.number_id = s.number_id
    LEFT JOIN sms_first  sf ON sf.number_id = s.number_id
    GROUP BY s.phone_e164
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
  player AS (
    SELECT i.workspace, i.cio_id, MIN(i.phone_e164) AS phone_e164, MIN(fc.first_at) AS first_at
    FROM identity i
    JOIN first_contact fc ON fc.phone_e164 = i.phone_e164
    GROUP BY i.workspace, i.cio_id
  ),
  dep AS (
    SELECT p.phone_e164, e.currency, e.amount_norm,
           CASE WHEN e.amount_local ~ '^-?[0-9]+(\.[0-9]+)?$' THEN e.amount_local::numeric END AS amount_local,
           (e.occurred_at >= p.first_at) AS after_contact
    FROM public.cio_events e
    JOIN player p ON p.cio_id = e.cio_id AND p.workspace = e.workspace
    WHERE e.event_name = 'deposit_made'
      AND e.occurred_at >= p_from
      AND e.occurred_at <  p_to
  )
  SELECT
    COALESCE(d.currency, '?')                                                      AS currency,
    COUNT(*) FILTER (WHERE d.after_contact)::int                                   AS deposits,
    COUNT(DISTINCT d.phone_e164) FILTER (WHERE d.after_contact)::int               AS players,
    COALESCE(SUM(d.amount_local) FILTER (WHERE d.after_contact), 0)                AS amount_local,
    COALESCE(SUM(d.amount_norm)  FILTER (WHERE d.after_contact), 0)                AS amount_eur,
    COUNT(*) FILTER (WHERE d.after_contact IS NOT TRUE)::int                       AS deposits_before
  FROM dep d
  GROUP BY 1
  ORDER BY amount_eur DESC;
$$;
