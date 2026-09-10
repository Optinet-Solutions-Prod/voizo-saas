-- 2026-09-10 VOZ-511 — the strict reached rule, "Spoke with them", and Maria's attribution window.
-- Apply in one paste. Re-runnable: every object is dropped and recreated.
--
-- WHY. The Audience tab calls a player "Reached" on the LEAN rule: a call that connected and was
-- not voicemail. That counts a line which answered in silence and a player who hung up in four
-- seconds. Maria asked on 27 Aug for both to be excluded. Measured on 10 Sep over all 79,267 calls:
--
--     lean-reached calls    10,077
--     strict-reached calls   1,884
--     dropped                8,198   (81.4% of lean: 6,527 answered in silence, 1,671 hung up early)
--
-- The 08 Sep handoff recorded this as "5,307 of 9,982 (53.2%)". That numerator does NOT reproduce
-- under any rule tried (silent-only, duration-only, silence-timed-out-only, 0-or-1-turn, several
-- date windows, with and without ghost/test campaigns); the denominator does. The finding held, it
-- was just understated. scripts/_gate-0910-strict-reached.cjs carries the measurement and the
-- known-bad controls, and after this file is applied it also proves the SQL below agrees with the
-- TypeScript rule call by call.
--
-- THE RULE. Not invented here: it is deriveAttemptTag (src/lib/dashboardAnalytics.ts) filtered by
-- REACHED_TAGS (src/app/analytics/recordsDisplay.ts) = positive, neutral, declined, agent_timeout.
-- Transcribed in priority order, because getting the ORDER wrong silently moves calls between
-- buckets:
--     goal_reached                        -> positive        REACHED
--     not connected                       -> unreachable     no
--     voicemail                           -> voicemail       no
--     pipeline-error / not-responding     -> agent_timeout   REACHED
--     zero substantive user turns         -> silent_pickup   no      <- newly excluded
--     the contact declined                -> declined        REACHED
--     early hang-up                       -> early_hangup    no      <- newly excluded
--     otherwise                           -> neutral         REACHED
--
-- WHAT CHANGES FOR CALLERS. Nothing, unless they ask for it:
--   * `reached` keeps its lean meaning, so every existing card and export is untouched;
--   * `spoke_with` is a NEW column carrying the strict rule;
--   * p_contact gains 'spoke' and 'never_spoke';
--   * p_attrib_days is a NEW LAST parameter with a DEFAULT of 0 (no limit), so the deployed
--     11-argument calls keep working and can be updated at leisure.
--
-- MARIA'S ATTRIBUTION WINDOW. p_attrib_days = 2 counts a deposit as "after contact" only when it
-- lands within 2 days of the player's first contact. 0 keeps today's behaviour, which is "any time
-- after, forever". This affects dep_after, dep_after_eur, first_dep_after_at and the depositor
-- filters, all through one predicate.
--
-- PERFORMANCE. The turn count is the only new work and it runs on calls_v2 rows already being
-- scanned by calls_agg. Transcripts are short (a few dozen lines). Measured on prod after applying:
-- see the gate. enable_nestloop stays off, same as v3.

-- ── 1. substantive user turns, in SQL ────────────────────────────────────────────────────
-- transcriptClassify.parseTranscriptTurns splits on newlines, treats "Speaker: text" as the start
-- of a new turn, and appends an unprefixed line to the turn above it. A turn counts as substantive
-- when its text trims to 2 characters or more.
--
-- Every one of 400 sampled prod transcripts is uniformly "Speaker: text", one turn per line, with
-- no bare speaker lines and no unprefixed continuations, so counting prefixed user lines whose
-- remainder trims to >= 2 characters is exact for this data. It is NOT a general reimplementation
-- of the parser, and it is not trusted on that claim: the gate compares this function against the
-- TypeScript one on every call in the database and requires an exact match.
DROP FUNCTION IF EXISTS public.voizo_user_turns(text);
CREATE FUNCTION public.voizo_user_turns(p_text text)
RETURNS int
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT COALESCE(COUNT(*), 0)::int
  FROM regexp_split_to_table(COALESCE(p_text, ''), E'\r?\n') AS ln
  WHERE ln ~* '^\s*(User|Customer|Caller|Human)\s*:'
    AND length(btrim(regexp_replace(ln, '^\s*(User|Customer|Caller|Human)\s*:', '', 'i'))) >= 2;
$$;

-- ── 2. the strict rule for one call ──────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.voizo_spoke_with(text, boolean, boolean, int, text, jsonb, boolean);
CREATE FUNCTION public.voizo_spoke_with(
  p_status text,
  p_voicemail boolean,
  p_goal_reached boolean,
  p_duration_seconds int,
  p_ended_reason text,
  p_transcript jsonb,
  p_declined boolean
)
RETURNS boolean
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE
    WHEN p_goal_reached IS TRUE THEN TRUE                                    -- positive
    WHEN p_status IS DISTINCT FROM 'completed'
     AND p_status IS DISTINCT FROM 'answered' THEN FALSE                     -- unreachable
    WHEN p_voicemail IS TRUE THEN FALSE                                      -- voicemail
    WHEN p_ended_reason LIKE 'pipeline-error%'
      OR p_ended_reason = 'assistant-not-responding' THEN TRUE               -- agent_timeout
    WHEN public.voizo_user_turns(p_transcript->>'text') = 0 THEN FALSE       -- silent_pickup
    WHEN p_declined IS TRUE THEN TRUE                                        -- declined
    -- early hang-up, in the same order as isEarlyHangup:
    WHEN p_ended_reason = 'silence-timed-out' THEN FALSE
    WHEN public.voizo_user_turns(p_transcript->>'text') > 1 THEN TRUE        -- real back-and-forth
    WHEN p_ended_reason IN ('customer-ended-call', 'assistant-ended-call',
                            'assistant-said-end-call-phrase',
                            'assistant-ended-call-after-message-spoken') THEN FALSE
    WHEN p_duration_seconds IS NOT NULL AND p_duration_seconds < 15 THEN FALSE
    ELSE TRUE                                                                -- neutral
  END;
$$;

-- ── 3. the gate's cross-check hook ───────────────────────────────────────────────────────
-- Returns the strict verdict for a batch of call ids so scripts/_gate-0910-strict-reached.cjs can
-- diff SQL against TypeScript row by row. Read-only, and it exists for verification, not for the app.
DROP FUNCTION IF EXISTS public.voizo_call_spoke_with(uuid[]);
CREATE FUNCTION public.voizo_call_spoke_with(p_call_ids uuid[])
RETURNS TABLE (call_id uuid, spoke_with boolean)
LANGUAGE sql STABLE AS $$
  SELECT c.id,
         public.voizo_spoke_with(c.status, c.voicemail, c.goal_reached, c.duration_seconds,
                                 c.ended_reason, c.transcript,
                                 (n.outcome = 'declined_offer'))
  FROM public.calls_v2 c
  LEFT JOIN public.campaign_numbers_v2 n ON n.id = c.campaign_number_id
  WHERE c.id = ANY(p_call_ids);
$$;

-- ── 4. audience_lane_players v4 ──────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.audience_lane_players(uuid[], timestamptz, timestamptz, text, text, uuid[], text, text, text, int, int);
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
           -- lean rule, unchanged: every existing card and export reads this
           BOOL_OR(c.status IN ('completed','answered') AND NOT (c.voicemail IS TRUE AND c.goal_reached IS NOT TRUE)) AS reached,
           -- strict rule (VOZ-511): a call somebody actually spoke on
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
           COALESCE(ca.calls, 0) AS calls,
           LEAST(ca.first_call, sa.first_sms) AS first_at,
           GREATEST(ca.last_call, sa.last_sms) AS last_at,
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
           (ARRAY_AGG(pn.campaign_id ORDER BY pn.last_at DESC NULLS LAST))[1] AS last_campaign_id,
           MIN(pn.first_at) AS first_at,
           MAX(pn.last_at) AS last_at,
           SUM(pn.calls)::int AS calls,
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
  dep_win AS (
    SELECT o.phone_e164
    FROM public.cio_events e
    JOIN owner o ON o.cio_id = e.cio_id AND o.workspace = e.workspace
    JOIN per_player pp ON pp.phone_e164 = o.phone_e164
    WHERE e.event_name = 'deposit_made'
      AND e.occurred_at >= p_from AND e.occurred_at < p_to
      AND e.occurred_at >= pp.first_at
      -- Maria's attribution window: 0 means "any time after", as before.
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
            WHEN 'spoke'       THEN pp.spoke_with
            WHEN 'never_spoke' THEN NOT pp.spoke_with
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
  )
  SELECT f.phone_e164, f.display_name, f.last_campaign_id, f.first_at, f.last_at, f.calls,
         f.reached, f.spoke_with, f.texted, f.delivered, f.cio_known,
         f.dep_after, f.dep_after_eur, f.dep_before, f.first_dep_after_at, f.last_dep_at,
         f.dep_after_in_window, f.dep_after_in_window_eur,
         COUNT(*) OVER () AS total_count
  FROM filtered f
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
ALTER FUNCTION public.audience_lane_players(uuid[], timestamptz, timestamptz, text, text, uuid[], text, text, text, int, int, int) SET enable_nestloop = off;

-- Verify after applying, in this order:
--   node scripts/_gate-0910-strict-reached.cjs      -- part 2 must be an EXACT match on every call
--   node scratchpad/q-lane-players-recon.cjs        -- the v3 recon still passes (lean rule untouched)
--
-- ── Rollback ─────────────────────────────────────────────────────────────────────────────
-- Re-apply 2026-09-07_audience_lane_players_rpc.sql, then:
--   DROP FUNCTION IF EXISTS public.voizo_call_spoke_with(uuid[]);
--   DROP FUNCTION IF EXISTS public.voizo_spoke_with(text, boolean, boolean, int, text, jsonb, boolean);
--   DROP FUNCTION IF EXISTS public.voizo_user_turns(text);
