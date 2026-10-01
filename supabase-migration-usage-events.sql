-- Cost per organization.
--   usage_events      every paid provider call the app makes outside campaign calls (demo calls,
--                     agent matching, call summaries, QA judging, …), with the org it was for.
--   org_cost_summary  one row per organization: campaign calls (calls_v2 cost columns joined
--                     through campaigns_v2.org_id) + usage_events, for the last N days.
-- Run in the Supabase SQL editor after supabase-migration-saas-tenancy.sql. Safe to re-run.

create table if not exists usage_events (
  id          bigserial primary key,
  org_id      uuid references organizations(id) on delete cascade,   -- null = public demo / platform
  provider    text not null,                                          -- vapi | openai | elevenlabs | other
  kind        text not null,                                          -- demo_call | agent_match | call_summary | …
  units       numeric,                                                -- seconds, tokens or characters
  usd         numeric(12,6) not null default 0,
  ref         text,                                                   -- vapi call id, openai request id
  meta        jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists usage_events_org_created_idx on usage_events (org_id, created_at desc);
create index if not exists usage_events_created_idx on usage_events (created_at desc);

alter table usage_events enable row level security;
drop policy if exists usage_events_org_read on usage_events;
create policy usage_events_org_read on usage_events for select using (org_id = current_org_id());

create or replace function org_cost_summary(p_days int default 30)
returns table (
  org_id uuid, org_name text, org_slug text, plan text,
  calls bigint, demo_calls bigint,
  vapi_usd numeric, openai_usd numeric, other_usd numeric, total_usd numeric
)
language sql security definer set search_path = public as $$
  with campaign_calls as (
    select c.org_id,
           count(*)                                  as n,
           coalesce(sum(v.vapi_cost_usd), 0)         as vapi,
           coalesce(sum(v.openai_cost_usd), 0)       as openai
      from calls_v2 v
      join campaigns_v2 c on c.id = v.campaign_id
     where v.created_at >= now() - make_interval(days => p_days)
     group by c.org_id
  ), events as (
    select org_id,
           coalesce(sum(usd) filter (where provider = 'vapi'), 0)                       as vapi,
           coalesce(sum(usd) filter (where provider = 'openai'), 0)                     as openai,
           coalesce(sum(usd) filter (where provider not in ('vapi', 'openai')), 0)      as other,
           count(*) filter (where kind = 'demo_call')                                   as demo
      from usage_events
     where created_at >= now() - make_interval(days => p_days)
     group by org_id
  )
  select coalesce(cc.org_id, ev.org_id)                                  as org_id,
         coalesce(o.name, 'Public demos / platform')                     as org_name,
         o.slug                                                           as org_slug,
         o.plan                                                           as plan,
         coalesce(cc.n, 0)                                                as calls,
         coalesce(ev.demo, 0)                                             as demo_calls,
         round(coalesce(cc.vapi, 0) + coalesce(ev.vapi, 0), 4)            as vapi_usd,
         round(coalesce(cc.openai, 0) + coalesce(ev.openai, 0), 4)        as openai_usd,
         round(coalesce(ev.other, 0), 4)                                  as other_usd,
         round(coalesce(cc.vapi, 0) + coalesce(ev.vapi, 0) + coalesce(cc.openai, 0) + coalesce(ev.openai, 0) + coalesce(ev.other, 0), 4) as total_usd
    from campaign_calls cc
    full outer join events ev on ev.org_id = cc.org_id
    left join organizations o on o.id = coalesce(cc.org_id, ev.org_id)
   order by total_usd desc nulls last;
$$;

revoke all on function org_cost_summary(int) from public;
grant execute on function org_cost_summary(int) to service_role;
