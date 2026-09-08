-- What came before a deposit (VOZ-509, Jasiel 2026-09-08: "build the last-touch card").
--
-- One row per bucket for the lane's deposits in a window, labelled by the LATEST Voizo touch at or
-- before each deposit within p_window_hours. Mirrors src/lib/lastTouch.ts exactly, so the card and
-- the unit tests cannot disagree: latest touch wins; on an identical timestamp the stronger
-- evidence wins (call_spoke > sms_delivered > call > sms); a touch AFTER the deposit is never
-- credited; a deposit with no visible touch lands in 'none' rather than disappearing.
--
-- ⚠️ 'none' means "no Voizo touch we can see", NOT "organic". cio_events holds deposits and nothing
-- else (9,954 rows, all deposit_made, measured 2026-09-08), so CRM email/bonus/login activity is
-- invisible lane-wide and most of 'none' is that. Measured on the 1,239 deposits tied to a phone we
-- hold: 'none' is 90.7% at 24h, 82.7% at 72h, 72.0% at 7d. Proximity is not lift either: the 25 Aug
-- study found contacted and never-reached players deposit at the same rate. Only a holdout proves
-- cause. When the nightly CIO pull lands (VOZ-461/479) its touch kinds join the union below.
--
-- Verify after applying (the 09-07 recipe: apply, reconcile, then trust):
--   node q-lasttouch-recon.cjs      -- compares this function against the same rules computed in JS

create or replace function public.audience_lane_last_touch(
  p_campaign_ids uuid[],
  p_from timestamptz,
  p_to timestamptz,
  p_window_hours int default 168
)
returns table (
  bucket     text,
  deposits   bigint,
  players    bigint,
  amount_eur numeric
)
language sql
stable
as $$
  with lane_members as (
    -- ONE phone per cio_id. Without distinct on, a cio_id mapped to two phones duplicates its
    -- deposits and every share above it inflates (18,776 rows hold 18,762 distinct cio_ids).
    select distinct on (r.cio_id) r.cio_id, r.phone_e164
    from public.realtime_seen_members r
    where r.parent_campaign_id = any(p_campaign_ids)
      and r.cio_id is not null
      and r.phone_e164 is not null
    order by r.cio_id, r.first_seen_at desc nulls last
  ),
  dep as (
    -- candidates first (the 09-07 lesson: the window's rows before any join work)
    select e.cio_id, e.occurred_at, coalesce(e.amount_norm, 0)::numeric as amount_eur, m.phone_e164
    from public.cio_events e
    join lane_members m on m.cio_id = e.cio_id
    where e.event_name = 'deposit_made'
      and e.occurred_at >= p_from
      and e.occurred_at <= p_to
  ),
  touches as (
    select n.phone_e164,
           c.created_at as at,
           case when c.status = 'completed' and coalesce(c.duration_seconds, 0) >= 30 then 'call_spoke' else 'call' end as kind,
           case when c.status = 'completed' and coalesce(c.duration_seconds, 0) >= 30 then 4 else 2 end as rank
    from public.calls_v2 c
    join public.campaign_numbers_v2 n on n.id = c.campaign_number_id
    where c.created_at >= p_from - make_interval(hours => p_window_hours)
      and c.created_at <= p_to
    union all
    select n.phone_e164,
           s.created_at as at,
           case when s.status = 'delivered' then 'sms_delivered' else 'sms' end as kind,
           case when s.status = 'delivered' then 3 else 1 end as rank
    from public.sms_messages_v2 s
    join public.campaign_numbers_v2 n on n.id = s.campaign_number_id
    where s.created_at >= p_from - make_interval(hours => p_window_hours)
      and s.created_at <= p_to
  ),
  labelled as (
    select d.cio_id,
           d.amount_eur,
           coalesce((
             select t.kind
             from touches t
             where t.phone_e164 = d.phone_e164
               and t.at <= d.occurred_at
               and t.at >= d.occurred_at - make_interval(hours => p_window_hours)
             order by t.at desc, t.rank desc
             limit 1
           ), 'none') as bucket
    from dep d
  )
  select bucket,
         count(*)::bigint                as deposits,
         count(distinct cio_id)::bigint  as players,
         coalesce(sum(amount_eur), 0)::numeric as amount_eur
  from labelled
  group by bucket;
$$;

comment on function public.audience_lane_last_touch(uuid[], timestamptz, timestamptz, int) is
  'Deposits in a window bucketed by the latest Voizo touch before each one (call_spoke | sms_delivered | call | sms | none). Mirrors src/lib/lastTouch.ts. "none" means no touch WE CAN SEE: cio_events holds deposits only, so CRM activity is invisible. Proximity, not lift.';

-- The touches subquery is the cost. If this trips Supabase's 8 s statement_timeout (57014) on an
-- All-brands lifetime window, the 09-07 fix for audience_lane_players applies here too:
--   alter function public.audience_lane_last_touch(uuid[], timestamptz, timestamptz, int) set enable_nestloop = off;
-- The phone index that function needed already exists: realtime_seen_members_phone_idx.

-- Rollback:
-- drop function if exists public.audience_lane_last_touch(uuid[], timestamptz, timestamptz, int);
