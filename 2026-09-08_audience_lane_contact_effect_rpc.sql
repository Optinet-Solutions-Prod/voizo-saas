-- Contacted vs not contacted (Jasiel 2026-09-08), replacing "What came before the deposit".
--
-- Why the change: that card's denominator was every deposit, which Voizo does not control, so its
-- biggest bar ("no touch on record", 94.7%) was really a statement about contact VOLUME, not about
-- players: in a 7-day window only about 866 of 20,425 members get called or texted. It invited a
-- wrong conclusion in both directions. This function measures the OWN-WORK rate instead, and puts
-- the comparison group beside it so the card cannot be read as proof of anything.
--
-- Two rows, one per cohort, over the window:
--   contacted      lane players with at least one call or text INSIDE the window. Their deposits
--                  count only from their FIRST touch in the window onwards.
--   not_contacted  lane players with none. Their deposits count from the window start.
-- That asymmetry is deliberate and CONSERVATIVE: the contacted group gets a shorter stretch of the
-- window in which a deposit counts, so it understates their rate rather than flattering it.
--
-- Denominator caveat, stated on the card: only players carrying a Customer.io id can be checked for
-- deposits at all, so both cohorts count identifiable players. Measured 2026-09-08, all 866
-- contacted players in the last 7 days were identifiable, so this is not currently a big cut.
--
-- ⚠️ This is OBSERVATIONAL. Voizo chooses who to call, so the two cohorts are not alike and a gap
-- would not prove cause. Its value is the opposite: measured 2026-09-08 the rates were 0.69% vs
-- 0.56% on 6 deposits, which is noise, and that is the honest thing for the card to show. When the
-- two rates genuinely separate, that is the first sign worth chasing with a holdout.
--
-- Verify after applying: node q-contact-effect-recon.cjs

create or replace function public.audience_lane_contact_effect(
  p_campaign_ids uuid[],
  p_from timestamptz,
  p_to timestamptz
)
returns table (
  cohort     text,
  players    bigint,
  depositors bigint,
  deposits   bigint,
  amount_eur numeric
)
language sql
stable
as $$
  with lane_members as (
    -- ONE phone per cio_id, newest sighting wins (the same rule audience_lane_last_touch uses;
    -- without it a cio_id mapped to two phones is counted twice and every rate shifts).
    select distinct on (r.cio_id) r.cio_id, r.phone_e164
    from public.realtime_seen_members r
    where r.parent_campaign_id = any(p_campaign_ids)
      and r.cio_id is not null
      and r.phone_e164 is not null
    order by r.cio_id, r.first_seen_at desc nulls last
  ),
  touched as (
    -- first call or text to each phone inside the window
    select phone_e164, min(at) as first_at
    from (
      select n.phone_e164, c.created_at as at
      from public.calls_v2 c
      join public.campaign_numbers_v2 n on n.id = c.campaign_number_id
      where c.created_at >= p_from and c.created_at <= p_to
      union all
      select n.phone_e164, s.created_at as at
      from public.sms_messages_v2 s
      join public.campaign_numbers_v2 n on n.id = s.campaign_number_id
      where s.created_at >= p_from and s.created_at <= p_to
    ) t
    group by phone_e164
  ),
  dep as (
    select e.cio_id, e.occurred_at, coalesce(e.amount_norm, 0)::numeric as eur
    from public.cio_events e
    where e.event_name = 'deposit_made'
      and e.occurred_at >= p_from
      and e.occurred_at <= p_to
  ),
  members as (
    select lm.cio_id, lm.phone_e164, t.first_at
    from lane_members lm
    left join touched t on t.phone_e164 = lm.phone_e164
  ),
  scored as (
    select mm.cio_id,
           (mm.first_at is not null) as contacted,
           -- contacted: deposits from their first touch onwards. not contacted: the whole window.
           count(d.cio_id) filter (where d.occurred_at >= coalesce(mm.first_at, p_from))          as n_dep,
           coalesce(sum(d.eur) filter (where d.occurred_at >= coalesce(mm.first_at, p_from)), 0)  as eur
    from members mm
    left join dep d on d.cio_id = mm.cio_id
    group by mm.cio_id, mm.first_at
  )
  select case when contacted then 'contacted' else 'not_contacted' end as cohort,
         count(*)::bigint                            as players,
         count(*) filter (where n_dep > 0)::bigint   as depositors,
         coalesce(sum(n_dep), 0)::bigint             as deposits,
         coalesce(sum(eur), 0)::numeric              as amount_eur
  from scored
  group by contacted;
$$;

comment on function public.audience_lane_contact_effect(uuid[], timestamptz, timestamptz) is
  'Deposit rate of lane players contacted inside a window versus those not contacted. Contacted deposits count from their first touch onwards, which is conservative. OBSERVATIONAL: Voizo picks who to call, so a gap is not proof of cause. Replaces the "what came before the deposit" framing.';

-- If a wide window trips the 8 s statement_timeout (57014), the 09-07 lever applies here too:
--   alter function public.audience_lane_contact_effect(uuid[], timestamptz, timestamptz) set enable_nestloop = off;

-- Rollback:
-- drop function if exists public.audience_lane_contact_effect(uuid[], timestamptz, timestamptz);
