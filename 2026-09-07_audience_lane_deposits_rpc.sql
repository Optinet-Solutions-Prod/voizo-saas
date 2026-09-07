-- 2026-09-07 Audience lane deposits RPC — proposed, NOT YET APPLIED to prod.
-- Companion to 2026-09-04_audience_lane_reach_rpc.sql; apply both in the same SQL-editor paste.
--
-- WHY: the Audience tab's "Deposits by day" card (VOZ-481) and the Depositors view count deposits
-- made AFTER our first contact with the player, per calendar day, over a whole lane. "First
-- contact" is per PLAYER (phone): the earliest call or text across every number that phone holds
-- in the lane's campaigns. Answering that in the route means paging every number, call and text in
-- the lane (the 27-round-trip shape the reach RPC exists to avoid). One GROUP BY instead.
--
-- SHAPE: same contract as audience_lane_reach. The ROUTE picks the campaign ids with the app's
-- own brand and country parsers; this function never parses a campaign name. One row per UTC
-- calendar day that saw a deposit inside [p_from, p_to). Days with no deposit are absent: the
-- caller fills the axis and says "no deposits" for a day inside coverage and "not captured" for a
-- day outside it (the 08-25 capture ends 2026-08-25, live ingress starts 2026-09-02; the week
-- between is a gap, not a zero).
--
-- The join to money is (workspace, cio_id). cio_events.workspace comes from the webhook's signing
-- key. The player's cio_id comes from TWO places, because campaign_numbers_v2.cio_id only exists
-- for numbers loaded since 2026-09-01 (683 of 55,746 rows on 2026-09-07): the dial rows, and
-- realtime_seen_members (phone_e164 -> cio_id, every CRM-loaded player since 2026-07-24), taken
-- only under a parent of the SAME workspace as the lane campaign, so one brand's money never lands
-- in another brand's lane. Measured 2026-09-07 on lucky7even|AU: 5,180 of 6,856 phones resolve
-- (75.6%), the two sources never disagree, and the number-row path adds nothing the seen table
-- lacks. Hand-loaded sets (STEVIC) are in neither source and read "no record" on the tab.
-- COALESCE(cio_workspace,'lucky7even') mirrors brandKey()'s DEFAULT_BRAND_WORKSPACE in
-- campaignDisplay.ts (one campaign in prod has a NULL workspace); if that default ever changes in
-- TypeScript, change it here too.
--
-- `players` counts PHONES, like Members does: 831 phones hold more than one cio_id (a player
-- re-registered, or the same person under two brands), and counting identities would inflate it.
--
-- A deposit by a player the lane never contacted (no call, no text) is neither "after" nor
-- "before" contact: after_contact is NULL and it lands in deposits_before by the IS NOT TRUE test,
-- because for the card's purpose it is "not after contact".
--
-- amount_eur sums amount_norm, the EUR-normalised figure the ingress stores (the CRM's
-- human_amount_total). It is a gross sum for the tooltip, not attribution.
--
-- No SECURITY DEFINER, no GRANT, no new index (same precedent as the reach RPC). Safe to re-run.
--
-- VERIFICATION BEFORE THIS IS TRUSTED: scratchpad q-lane-deposits-expected.cjs computes the same
-- per-day counts in JS by paging. Apply this, call it for one lane and window, and every day must
-- agree exactly. Do not wire the card until they do.

DROP FUNCTION IF EXISTS public.audience_lane_deposits(uuid[], timestamptz, timestamptz);
CREATE FUNCTION public.audience_lane_deposits(p_campaign_ids uuid[], p_from timestamptz, p_to timestamptz)
RETURNS TABLE (
  day date,
  deposits int,
  players int,
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
  -- Each channel folded to one row per number BEFORE the join (see the reach RPC for why).
  calls_first AS (
    SELECT c.campaign_number_id AS number_id, MIN(c.created_at) AS at
    FROM public.calls_v2 c
    WHERE c.campaign_number_id IN (SELECT number_id FROM scope)
    GROUP BY c.campaign_number_id
  ),
  sms_first AS (
    SELECT m.campaign_number_id AS number_id, MIN(m.created_at) AS at
    FROM public.sms_messages_v2 m
    WHERE m.campaign_number_id IN (SELECT number_id FROM scope)
    GROUP BY m.campaign_number_id
  ),
  -- First contact per PHONE. LEAST() skips NULLs, so a number with calls and no texts still counts.
  first_contact AS (
    SELECT s.phone_e164, MIN(LEAST(cf.at, sf.at)) AS first_at
    FROM scope s
    LEFT JOIN calls_first cf ON cf.number_id = s.number_id
    LEFT JOIN sms_first  sf ON sf.number_id = s.number_id
    GROUP BY s.phone_e164
  ),
  -- Every (workspace, cio_id, phone) the lane knows, from both sources.
  identity AS (
    SELECT s.workspace, s.cio_id, s.phone_e164
    FROM scope s
    WHERE s.cio_id IS NOT NULL
    UNION
    SELECT s.workspace, rs.cio_id, s.phone_e164
    FROM scope s
    JOIN public.realtime_seen_members rs ON rs.phone_e164 = s.phone_e164
    JOIN public.campaigns_v2 pc ON pc.id = rs.parent_campaign_id
     AND COALESCE(pc.cio_workspace, 'lucky7even') = s.workspace
  ),
  -- One row per CRM identity: a cio_id that sits on two phones takes the earlier first contact and
  -- the first phone, so no deposit can be counted twice.
  player AS (
    SELECT i.workspace, i.cio_id, MIN(i.phone_e164) AS phone_e164, MIN(fc.first_at) AS first_at
    FROM identity i
    JOIN first_contact fc ON fc.phone_e164 = i.phone_e164
    GROUP BY i.workspace, i.cio_id
  ),
  dep AS (
    SELECT p.phone_e164, e.occurred_at, e.amount_norm,
           (e.occurred_at >= p.first_at) AS after_contact
    FROM public.cio_events e
    JOIN player p ON p.cio_id = e.cio_id AND p.workspace = e.workspace
    WHERE e.event_name = 'deposit_made'
      AND e.occurred_at >= p_from
      AND e.occurred_at <  p_to
  )
  SELECT
    (occurred_at AT TIME ZONE 'UTC')::date                                        AS day,
    COUNT(*)            FILTER (WHERE after_contact)::int                          AS deposits,
    COUNT(DISTINCT phone_e164) FILTER (WHERE after_contact)::int                   AS players,
    COALESCE(SUM(amount_norm) FILTER (WHERE after_contact), 0)                     AS amount_eur,
    COUNT(*)            FILTER (WHERE after_contact IS NOT TRUE)::int              AS deposits_before
  FROM dep
  GROUP BY 1
  ORDER BY 1;
$$;
