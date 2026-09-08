-- Contact this window (Jasiel 2026-09-08). What Voizo DID in the window and what followed, with no
-- comparison group and no rate claim about cause.
--
-- This replaces "What came before the deposit", and it deliberately does NOT ship the
-- contacted-vs-not comparison that was drafted alongside it. Two reasons, both measured:
--   1. EXPOSURE. Contacted players only count from the moment they were called, averaging 4.25 days
--      of a 7-day window against 7.00 for everyone else. Raw rates read 0.63% vs 0.59%, which looks
--      like nothing; per 1,000 player-days they are 1.49 vs 0.85. A side-by-side card would have
--      hidden the only positive signal in the data.
--   2. SELECTION. The contacted cohort in the last 7 days was 634 reactivation plus 315 new
--      registrations: dormant and brand-new players. The comparison group is everyone else,
--      including habitual depositors. Different populations, so no gap either way proves cause.
-- The exposure-adjusted figure rests on SIX deposits and is recorded in the handoff, not on a card.
-- Cause is a holdout question; see the holdout design filed the same day.
--
-- One row for the window, scoped to the lane's campaigns:
--   contacted   distinct phones in the lane with at least one call or text inside the window
--   spoke       of those, at least one call that connected and ran 30 s or more
--   texted      of those, at least one text sent
--   delivered   of those, at least one text the handset confirmed
--   depositors  of those, at least one deposit at or after their FIRST touch in the window
--   amount_eur  those deposits, CRM-normalised
-- Only players carrying a Customer.io id can be checked for deposits at all; measured 2026-09-08 all
-- 949 contacted players were identifiable, so depositors is not currently cut by that.
--
-- Much lighter than the comparison it replaces: it walks the ~950 touched players, not all 18,770
-- lane members, which matters because /api/audience/reach already timed out under load on 2026-09-08.
--
-- Verify after applying: node q-contact-window-recon.cjs

create or replace function public.audience_lane_contact_window(
  p_campaign_ids uuid[],
  p_from timestamptz,
  p_to timestamptz
)
returns table (
  contacted  bigint,
  spoke      bigint,
  texted     bigint,
  delivered  bigint,
  depositors bigint,
  amount_eur numeric
)
language sql
stable
as $$
  with touched as (
    select n.phone_e164,
           min(x.at)                                as first_at,
           bool_or(x.kind = 'spoke')                as did_spoke,
           bool_or(x.kind in ('sms_sent', 'sms_delivered')) as did_text,
           bool_or(x.kind = 'sms_delivered')        as did_deliver
    from (
      select c.campaign_number_id as num_id,
             c.created_at         as at,
             case when c.status = 'completed' and coalesce(c.duration_seconds, 0) >= 30 then 'spoke' else 'call' end as kind
      from public.calls_v2 c
      where c.created_at >= p_from and c.created_at <= p_to
      union all
      select s.campaign_number_id,
             s.created_at,
             case when s.status = 'delivered' then 'sms_delivered' else 'sms_sent' end
      from public.sms_messages_v2 s
      where s.created_at >= p_from and s.created_at <= p_to
    ) x
    join public.campaign_numbers_v2 n on n.id = x.num_id
    where n.campaign_id = any(p_campaign_ids)
    group by n.phone_e164
  ),
  ids as (
    -- ONE phone per cio_id, newest sighting wins: the same rule the other audience functions use.
    select distinct on (r.cio_id) r.cio_id, r.phone_e164
    from public.realtime_seen_members r
    where r.cio_id is not null and r.phone_e164 is not null
    order by r.cio_id, r.first_seen_at desc nulls last
  ),
  money as (
    select count(distinct t.phone_e164)                        as depositors,
           coalesce(sum(coalesce(e.amount_norm, 0)), 0)::numeric as eur
    from touched t
    join ids i on i.phone_e164 = t.phone_e164
    join public.cio_events e on e.cio_id = i.cio_id
    where e.event_name = 'deposit_made'
      and e.occurred_at >= t.first_at
      and e.occurred_at <= p_to
  )
  select (select count(*) from touched)::bigint,
         (select count(*) from touched where did_spoke)::bigint,
         (select count(*) from touched where did_text)::bigint,
         (select count(*) from touched where did_deliver)::bigint,
         m.depositors::bigint,
         m.eur
  from money m;
$$;

comment on function public.audience_lane_contact_window(uuid[], timestamptz, timestamptz) is
  'What Voizo did in a window and what followed: players contacted, of those how many were spoken to, texted, had a text delivered, and how many deposited at or after their first touch. No comparison group by design: the contacted cohort is selected (reactivation and new registrations) and its deposit exposure is shorter than the windows, so any side-by-side rate would mislead. Cause is a holdout question.';

-- Rollback:
-- drop function if exists public.audience_lane_contact_window(uuid[], timestamptz, timestamptz);
