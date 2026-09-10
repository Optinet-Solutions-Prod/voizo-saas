-- 2026-09-11 Audience: ONE Reach card that follows the window and the filters.
-- Apply in one paste. Re-runnable. Design: .agent/tasks/2026-09-11_DESIGN_reach_card_windowed.md
--
-- WHY. The tab carried three cards with three windows and THREE different meanings of "reached":
--   Reach              all time,      lean: connected and not voicemail
--   Contact this window  the window,  a completed call of 30 seconds or more
--   the Depositors filter the window, strict: public.voizo_spoke_with()
-- Jasiel 2026-09-10, reading the money strip (which follows the window and the table's filters
-- since b188855) above a filter-blind Reach card: "if we're looking at 7d it should be accurate to
-- tell the players we reached, dialled, texted, emailed, deposited". One card, one window, one
-- population, both reach rules named side by side. Contact this window goes.
--
-- WHAT IT RETURNS. One row, all of it about the SAME population and the SAME window.
--
-- THE POPULATION is the Depositors table's, copied verbatim from audience_lane_deposit_rollup v2
-- through `kept`: the same family membership, the same search, the same Contact ladder on lifetime
-- facts, the same Deposited ladder, the same phone-per-CRM-identity rule. So "Spoke with them"
-- means the same thing on this card, on the strip and in the table. The FILTERS are lifetime facts
-- (that is what the table means by them); the ROWS below are all inside the window.
--
--   contacted            dialled OR texted inside the window. Deliberately the union of the two
--                        channel rows, so dialled <= contacted and texted <= contacted hold by
--                        construction and the denominator can never be smaller than a bar above it.
--   dialled              at least one call attempt in the window
--   answered             LEAN: the call connected and was not voicemail. The dashboard's rule,
--                        lifted verbatim from audience_lane_reach. Called "Answered", not
--                        "Reached": "reached" is the loaded word and the strict row sits beside it.
--   spoke                STRICT: public.voizo_spoke_with() on any call in the window. The same
--                        function the "Spoke with them" filter uses, so the card and the table agree.
--   texted               at least one text SENT in the window (status sent or delivered)
--   text_delivered       at least one the handset confirmed
--   texted_not_answered  texted and never answered, for the "Not a funnel" footer
--   msgs*                TEXTS, not people, in the window. Counted over the FILTER population, not
--                        over `contacted`: a player whose only in-window text FAILED is not
--                        contacted by the rule above, and dropping their message would put
--                        msgs_failed below what audience_lane_reach reports at All time, which is
--                        the known-good gate. Texts and people never share a bar on the card.
--   emailed              our own follow-up trigger reaching Customer.io in the window
--                        (cio_track_events, status sent). It counts OUR side, not the CRM's send:
--                        whether the email went out and was opened is the CRM's record and lives in
--                        the player's drawer. Replaces the old "Emailed: none yet" row.
--   depositors/deposits/amount_eur
--                        players TOUCHED in the window who deposited at or after that first touch,
--                        up to the window end. A different rule from the money strip above it, and
--                        both are legitimate: the strip is money DATED in the window after any
--                        earlier contact (an August player depositing this week counts); this is
--                        players touched THIS week who deposited after that touch. Both name their
--                        rule on the page. Order, not cause: a holdout answers cause.
--
-- LAZINESS, kept from v5. The Contact filter's lane-wide strict pass runs only for the two values
-- that read it, and the Deposited ladder's lifetime deposit scan only for the values that need it.
-- The `spoke` ROW always pays a strict pass, but only over calls INSIDE THE WINDOW for players in
-- the population, which at 7d is a few thousand calls rather than all 79,000. At All time it is the
-- whole lane, which is what the card is asking for. Measure it (the gate times All).
--
-- THE OWNER BRIDGE is MIN(phone) per (workspace, cio_id), like every other Audience function.
-- audience_lane_contact_window, which this replaces, used the NEWEST sighting instead, so its
-- depositor count can differ by a player or two. The gate prints both and fails only above a
-- handful. That function is left in the database, unused, for a later cleanup paste.
--
-- Verify after applying:  node scripts/_gate-0911-reach-window.cjs   (every part must be green)

DROP FUNCTION IF EXISTS public.audience_lane_reach_window(uuid[], timestamptz, timestamptz, text, text, uuid[], text);
CREATE FUNCTION public.audience_lane_reach_window(
  p_campaign_ids uuid[],
  p_from timestamptz,
  p_to timestamptz,
  p_deposited text,
  p_contact text,
  p_family_ids uuid[],
  p_q text
)
RETURNS TABLE (
  contacted int,
  dialled int,
  answered int,
  spoke int,
  texted int,
  text_delivered int,
  texted_not_answered int,
  msgs int,
  msgs_delivered int,
  msgs_failed int,
  msgs_unconfirmed int,
  emailed int,
  depositors int,
  deposits int,
  amount_eur numeric
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
  -- ── The FILTER population: lifetime facts, exactly as the table computes them. ──
  calls_agg AS (
    SELECT c.campaign_number_id AS number_id,
           BOOL_OR(c.status IN ('completed','answered') AND NOT (c.voicemail IS TRUE AND c.goal_reached IS NOT TRUE)) AS reached,
           -- Only the two Contact values read the lifetime strict verdict; nothing else pays for it.
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
    LEFT JOIN calls_agg   ca ON ca.number_id = s.number_id
    LEFT JOIN sms_agg     sa ON sa.number_id = s.number_id
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
  -- The Deposited ladder is a LIFETIME fact; pull lifetime deposits only when a value is set.
  dep_all AS (
    SELECT o.phone_e164,
           (e.occurred_at >= p.first_at) AS after_contact,
           (e.occurred_at >= p_from AND e.occurred_at < p_to) AS in_window
    FROM public.cio_events e
    JOIN owner o ON o.cio_id = e.cio_id AND o.workspace = e.workspace
    JOIN pop p ON p.phone_e164 = o.phone_e164
    WHERE e.event_name = 'deposit_made'
      AND p_deposited IN ('after','before','none','unknown')
  ),
  state AS (
    SELECT p.phone_e164,
           CASE WHEN p_deposited IN ('none','unknown')
                THEN EXISTS (SELECT 1 FROM identity i WHERE i.phone_e164 = p.phone_e164)
                ELSE TRUE END                                                AS cio_known,
           COUNT(d.phone_e164) FILTER (WHERE d.after_contact)                AS dep_after,
           COUNT(d.phone_e164) FILTER (WHERE d.after_contact IS NOT TRUE)    AS dep_before,
           COUNT(d.phone_e164) FILTER (WHERE d.after_contact AND d.in_window) AS dep_after_in_window
    FROM pop p
    LEFT JOIN dep_all d ON d.phone_e164 = p.phone_e164
    GROUP BY p.phone_e164
  ),
  -- `kept` is the population every number below is about: the table's rows, filters and all.
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
  -- The population's own numbers, so every window pass below reads a narrowed set.
  nums AS (
    SELECT s.number_id, s.phone_e164, s.declined
    FROM scope s
    JOIN kept k ON k.phone_e164 = s.phone_e164
  ),
  -- ── The WINDOW. Everything from here is inside [p_from, p_to). ──
  win_calls AS (
    SELECT c.campaign_number_id AS number_id,
           MIN(c.created_at) AS first_at,
           BOOL_OR(c.status IN ('completed','answered') AND NOT (c.voicemail IS TRUE AND c.goal_reached IS NOT TRUE)) AS answered,
           BOOL_OR(public.voizo_spoke_with(c.status, c.voicemail, c.goal_reached, c.duration_seconds,
                                           c.ended_reason, c.transcript, n.declined)) AS spoke
    FROM public.calls_v2 c
    JOIN nums n ON n.number_id = c.campaign_number_id
    WHERE c.created_at >= p_from AND c.created_at < p_to
    GROUP BY c.campaign_number_id
  ),
  win_sms AS (
    SELECT m.campaign_number_id AS number_id,
           MIN(m.created_at) FILTER (WHERE m.status IN ('sent','delivered')) AS first_at,
           BOOL_OR(m.status IN ('sent','delivered')) AS texted,
           BOOL_OR(m.status = 'delivered') AS delivered
    FROM public.sms_messages_v2 m
    WHERE m.campaign_number_id IN (SELECT number_id FROM nums)
      AND m.created_at >= p_from AND m.created_at < p_to
    GROUP BY m.campaign_number_id
  ),
  win_player AS (
    SELECT n.phone_e164,
           LEAST(MIN(wc.first_at), MIN(ws.first_at)) AS first_at,
           COALESCE(BOOL_OR(wc.number_id IS NOT NULL), FALSE) AS dialled,
           COALESCE(BOOL_OR(wc.answered), FALSE)              AS answered,
           COALESCE(BOOL_OR(wc.spoke), FALSE)                 AS spoke,
           COALESCE(BOOL_OR(ws.texted), FALSE)                AS texted,
           COALESCE(BOOL_OR(ws.delivered), FALSE)             AS delivered
    FROM nums n
    LEFT JOIN win_calls wc ON wc.number_id = n.number_id
    LEFT JOIN win_sms   ws ON ws.number_id = n.number_id
    GROUP BY n.phone_e164
  ),
  -- TEXTS, not people. Over the whole filter population, so a player whose only in-window text
  -- failed still has that failure counted; see the header note on the known-good gate.
  fate AS (
    SELECT COUNT(*)::int                                                  AS msgs,
           COUNT(*) FILTER (WHERE m.status = 'delivered')::int            AS msgs_delivered,
           COUNT(*) FILTER (WHERE m.status IN ('failed','undelivered'))::int AS msgs_failed,
           COUNT(*) FILTER (WHERE m.status = 'sent')::int                 AS msgs_unconfirmed
    FROM public.sms_messages_v2 m
    WHERE m.campaign_number_id IN (SELECT number_id FROM nums)
      AND m.created_at >= p_from AND m.created_at < p_to
  ),
  -- Our follow-up trigger landing in Customer.io. Joined on campaign_number_id: this ledger is
  -- ours, so it needs no CRM identity bridge. `sent_at` is stamped when the Track API accepts;
  -- it has never been null on a 'sent' row, and COALESCE keeps the row rather than dropping it.
  mail AS (
    SELECT COUNT(DISTINCT n.phone_e164)::int AS emailed
    FROM public.cio_track_events t
    JOIN nums n ON n.number_id = t.campaign_number_id
    WHERE t.event_name = 'voizo_call_followup'
      AND t.status = 'sent'
      AND COALESCE(t.sent_at, t.created_at) >= p_from
      AND COALESCE(t.sent_at, t.created_at) <  p_to
  ),
  -- Money that followed a touch IN THIS WINDOW, from that touch to the window's end.
  money AS (
    SELECT COUNT(DISTINCT w.phone_e164)::int          AS depositors,
           COUNT(*)::int                              AS deposits,
           COALESCE(SUM(e.amount_norm), 0)::numeric   AS amount_eur
    FROM win_player w
    JOIN owner o ON o.phone_e164 = w.phone_e164
    JOIN public.cio_events e ON e.cio_id = o.cio_id AND e.workspace = o.workspace
    WHERE (w.dialled OR w.texted)
      AND e.event_name = 'deposit_made'
      AND e.occurred_at >= w.first_at
      AND e.occurred_at <  p_to
  )
  SELECT COUNT(*) FILTER (WHERE w.dialled OR w.texted)::int        AS contacted,
         COUNT(*) FILTER (WHERE w.dialled)::int                    AS dialled,
         COUNT(*) FILTER (WHERE w.answered)::int                   AS answered,
         COUNT(*) FILTER (WHERE w.spoke)::int                      AS spoke,
         COUNT(*) FILTER (WHERE w.texted)::int                     AS texted,
         COUNT(*) FILTER (WHERE w.delivered)::int                  AS text_delivered,
         COUNT(*) FILTER (WHERE w.texted AND NOT w.answered)::int  AS texted_not_answered,
         (SELECT msgs FROM fate), (SELECT msgs_delivered FROM fate),
         (SELECT msgs_failed FROM fate), (SELECT msgs_unconfirmed FROM fate),
         (SELECT emailed FROM mail),
         (SELECT depositors FROM money), (SELECT deposits FROM money), (SELECT amount_eur FROM money)
  FROM win_player w;
$$;
ALTER FUNCTION public.audience_lane_reach_window(uuid[], timestamptz, timestamptz, text, text, uuid[], text) SET enable_nestloop = off;

COMMENT ON FUNCTION public.audience_lane_reach_window(uuid[], timestamptz, timestamptz, text, text, uuid[], text) IS
  'The Audience tab''s merged Reach card: for the players contacted inside the window, and matching the Depositors table''s filters, how far each channel got and whether money followed. Both reach rules side by side: answered is the dashboard''s lean rule, spoke is the strict voizo_spoke_with() the Spoke with them filter uses. Replaces audience_lane_contact_window, whose 30-second rule was a third definition of the same word.';

-- ── Rollback ────────────────────────────────────────────────────────────────────────────────
-- DROP FUNCTION IF EXISTS public.audience_lane_reach_window(uuid[], timestamptz, timestamptz, text, text, uuid[], text);
-- The Reach card then reads "Not available yet" and names this file; the rest of the tab stands.
