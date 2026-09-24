-- ============================================================================
-- VOIZO SaaS — organizations, brands, members, invites, integrations,
-- phone numbers, agent purchases, and row-level tenant isolation.
--
-- Run ONCE in the Supabase SQL editor of the SaaS project. Idempotent: every
-- statement is guarded, so re-running is safe.
--
-- How isolation works
--   * Every org-owned root table gets `org_id uuid` defaulting to
--     current_org_id() — the caller's organization — so existing INSERT code
--     needs no change. Rows created by cron (no user) inherit org_id from
--     their parent campaign via trigger.
--   * All "Allow all" policies are dropped. New policies let an authenticated
--     user see rows of their own organization only; child tables are scoped
--     through their campaign / script / set. The service role (cron, webhooks)
--     bypasses RLS as before.
--   * The app sends the signed-in user's JWT on every request made on behalf
--     of a user (src/lib/supabaseServer.ts), so these policies are what the
--     app enforces. SECURITY DEFINER analytics functions are switched to
--     INVOKER so they respect the policies too.
-- ============================================================================

create extension if not exists pgcrypto;

-- ── Core tenancy tables ─────────────────────────────────────────────────────
create table if not exists organizations (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  slug        text not null unique,
  plan        text not null default 'free',
  settings    jsonb not null default '{}'::jsonb,
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists organization_members (
  org_id      uuid not null references organizations(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  role        text not null check (role in ('owner','admin','member')),
  created_at  timestamptz not null default now(),
  primary key (org_id, user_id),
  -- One organization per user for now (the app has a single "current org").
  constraint organization_members_user_unique unique (user_id)
);
create index if not exists organization_members_user_idx on organization_members(user_id);

create table if not exists organization_invites (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organizations(id) on delete cascade,
  email       text not null,
  role        text not null default 'member' check (role in ('admin','member')),
  token       text not null unique default encode(gen_random_bytes(24), 'hex'),
  invited_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default now() + interval '14 days',
  accepted_at timestamptz,
  accepted_by uuid references auth.users(id) on delete set null
);
create index if not exists organization_invites_org_idx on organization_invites(org_id);
create index if not exists organization_invites_email_idx on organization_invites(lower(email));

create table if not exists brands (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organizations(id) on delete cascade,
  name        text not null,
  -- Global uniqueness on purpose: campaigns_v2.cio_workspace and the cio_* cache tables are
  -- keyed by this slug, so two organizations must never share one.
  slug        text not null unique,
  color       text,
  settings    jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists brands_org_idx on brands(org_id);

-- Phase 3: per-organization provider credentials (encrypted by the app before storage).
create table if not exists org_integrations (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references organizations(id) on delete cascade,
  provider      text not null,
  label         text,
  credentials   text not null,             -- AES-GCM ciphertext (base64), see src/lib/integrations/crypto.ts
  config        jsonb not null default '{}'::jsonb,  -- non-secret settings (region, base url, sender ids)
  status        text not null default 'untested' check (status in ('untested','ok','failed')),
  last_tested_at timestamptz,
  last_error    text,
  created_by    uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (org_id, provider)
);

-- Phase 3: phone numbers an organization dials from.
create table if not exists phone_numbers (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references organizations(id) on delete cascade,
  brand_slug    text references brands(slug) on delete set null,
  e164          text not null,
  label         text,
  provider      text not null default 'other',  -- twilio | squaretalk | freeswitch | vapi | other
  country       text,
  capabilities  text[] not null default '{voice}',
  status        text not null default 'untested' check (status in ('untested','ok','failed')),
  last_tested_at timestamptz,
  last_error    text,
  created_at    timestamptz not null default now(),
  unique (org_id, e164)
);

-- Phase 5: pre-built agents an organization has unlocked (the free ones need no row).
create table if not exists agent_purchases (
  org_id      uuid not null references organizations(id) on delete cascade,
  agent_key   text not null,
  unlocked_by uuid references auth.users(id) on delete set null,
  note        text,
  created_at  timestamptz not null default now(),
  primary key (org_id, agent_key)
);

-- ── Helper functions ────────────────────────────────────────────────────────
-- The caller's organization (null for the service role / signed-out).
create or replace function current_org_id() returns uuid
language sql stable security definer set search_path = public as $$
  select org_id from organization_members where user_id = auth.uid() limit 1
$$;

create or replace function current_org_role() returns text
language sql stable security definer set search_path = public as $$
  select role from organization_members where user_id = auth.uid() limit 1
$$;

create or replace function is_org_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select role in ('owner','admin') from organization_members where user_id = auth.uid() limit 1), false)
$$;

-- Platform staff: app_metadata.role = "admin" on the auth user (only settable with the service role).
create or replace function is_platform_admin() returns boolean
language sql stable as $$
  select coalesce((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin', false)
$$;

-- Create an organization and make the caller its owner. Refuses if the caller already belongs to one.
create or replace function create_organization(p_name text, p_slug text)
returns organizations
language plpgsql security definer set search_path = public as $$
declare
  v_org organizations;
  v_slug text := lower(regexp_replace(coalesce(p_slug, p_name), '[^a-z0-9]+', '-', 'gi'));
  v_try  text := v_slug;
  v_n    int := 1;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if exists (select 1 from organization_members where user_id = auth.uid()) then
    raise exception 'already a member of an organization';
  end if;
  v_slug := trim(both '-' from v_slug);
  if v_slug = '' then v_slug := 'org'; end if;
  v_try := v_slug;
  while exists (select 1 from organizations where slug = v_try) loop
    v_n := v_n + 1; v_try := v_slug || '-' || v_n;
  end loop;
  insert into organizations (name, slug, created_by) values (trim(p_name), v_try, auth.uid()) returning * into v_org;
  insert into organization_members (org_id, user_id, role) values (v_org.id, auth.uid(), 'owner');
  return v_org;
end $$;

-- What an invite is for, before the person signs in (org name, email, role). Null if unknown/expired/used.
create or replace function invite_preview(p_token text)
returns table (org_name text, email text, role text, expired boolean, accepted boolean)
language sql stable security definer set search_path = public as $$
  select o.name, i.email, i.role, i.expires_at < now(), i.accepted_at is not null
  from organization_invites i join organizations o on o.id = i.org_id
  where i.token = p_token
$$;

-- Accept an invite: the signed-in user's email must match, and they must not already be in an org.
create or replace function accept_invite(p_token text)
returns organizations
language plpgsql security definer set search_path = public as $$
declare
  v_inv organization_invites;
  v_org organizations;
  v_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select * into v_inv from organization_invites where token = p_token;
  if v_inv.id is null then raise exception 'invite not found'; end if;
  if v_inv.accepted_at is not null then raise exception 'invite already used'; end if;
  if v_inv.expires_at < now() then raise exception 'invite expired'; end if;
  if lower(v_inv.email) <> v_email then raise exception 'this invite was sent to %', v_inv.email; end if;
  if exists (select 1 from organization_members where user_id = auth.uid()) then
    raise exception 'already a member of an organization';
  end if;
  insert into organization_members (org_id, user_id, role) values (v_inv.org_id, auth.uid(), v_inv.role);
  update organization_invites set accepted_at = now(), accepted_by = auth.uid() where id = v_inv.id;
  select * into v_org from organizations where id = v_inv.org_id;
  return v_org;
end $$;

grant execute on function current_org_id(), current_org_role(), is_org_admin(), is_platform_admin() to authenticated, anon;
grant execute on function create_organization(text, text), accept_invite(text) to authenticated;
grant execute on function invite_preview(text) to authenticated, anon;

-- ── org_id on every org-owned root table ────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array[
    'campaigns_v2','listener_scripts','listener_handlers','listener_collections','knowledge_bases',
    'do_not_call','suppression_list','local_segments','ghost_runs','listener_qa_prompts','golden_eval_sets','campaigns'
  ] loop
    execute format('alter table %I add column if not exists org_id uuid references organizations(id) on delete cascade', t);
    execute format('alter table %I alter column org_id set default current_org_id()', t);
    execute format('create index if not exists %I on %I(org_id)', t || '_org_idx', t);
  end loop;
end $$;

-- Cron-spawned child campaigns carry no auth.uid(): inherit the parent's organization.
create or replace function campaigns_v2_inherit_org() returns trigger
language plpgsql as $$
begin
  if new.org_id is null and new.parent_campaign_id is not null then
    select org_id into new.org_id from campaigns_v2 where id = new.parent_campaign_id;
  end if;
  return new;
end $$;
drop trigger if exists campaigns_v2_inherit_org on campaigns_v2;
create trigger campaigns_v2_inherit_org before insert on campaigns_v2
  for each row execute function campaigns_v2_inherit_org();

-- Scripts duplicated for a campaign copy the org of the operator (default) — nothing to do.
-- Ghost runs create their campaign under the operator — default covers it.

-- ── Row-level security ──────────────────────────────────────────────────────
-- 1) Drop every existing policy on the tables we scope (they were all "using (true)").
do $$
declare r record;
begin
  for r in
    select schemaname, tablename, policyname from pg_policies
    where schemaname = 'public' and tablename in (
      'organizations','organization_members','organization_invites','brands','org_integrations','phone_numbers','agent_purchases',
      'campaigns_v2','listener_scripts','listener_handlers','listener_collections','knowledge_bases','do_not_call','suppression_list',
      'local_segments','ghost_runs','listener_qa_prompts','golden_eval_sets','campaigns','contacts',
      'calls_v2','campaign_numbers_v2','sms_messages_v2','qa_scores','qa_calibration','call_labels','ghost_call_labels',
      'golden_eval_items','golden_eval_runs','listener_qa_analysis_runs','listener_qa_batch_jobs','prompt_versions',
      'local_segment_numbers','listener_script_nodes','listener_script_edges','listener_collection_handlers',
      'recurring_alert_state','realtime_alert_state','realtime_seen_members','scheduler_alert_state',
      'cio_events','cio_messages','cio_track_events','cio_delivery_sync','mobivate_optouts',
      'vapi_sip_pool','cron_heartbeats','alert_state','lab_settings','listener_qa_schedule','lab_call_events','lab_call_flow_state'
    )
  loop
    execute format('drop policy if exists %I on %I.%I', r.policyname, r.schemaname, r.tablename);
  end loop;
end $$;

-- 2) Enable RLS everywhere (service role bypasses).
do $$
declare t text;
begin
  foreach t in array array[
    'organizations','organization_members','organization_invites','brands','org_integrations','phone_numbers','agent_purchases',
    'campaigns_v2','listener_scripts','listener_handlers','listener_collections','knowledge_bases','do_not_call','suppression_list',
    'local_segments','ghost_runs','listener_qa_prompts','golden_eval_sets','campaigns','contacts',
    'calls_v2','campaign_numbers_v2','sms_messages_v2','qa_scores','qa_calibration','call_labels','ghost_call_labels',
    'golden_eval_items','golden_eval_runs','listener_qa_analysis_runs','listener_qa_batch_jobs','prompt_versions',
    'local_segment_numbers','listener_script_nodes','listener_script_edges','listener_collection_handlers',
    'recurring_alert_state','realtime_alert_state','realtime_seen_members','scheduler_alert_state',
    'cio_events','cio_messages','cio_track_events','cio_delivery_sync','mobivate_optouts',
    'vapi_sip_pool','cron_heartbeats','alert_state','lab_settings','listener_qa_schedule','lab_call_events','lab_call_flow_state'
  ] loop
    execute format('alter table %I enable row level security', t);
  end loop;
end $$;

-- 3) Tenancy tables.
create policy "members read their org" on organizations for select to authenticated
  using (id = current_org_id());
create policy "admins update their org" on organizations for update to authenticated
  using (id = current_org_id() and is_org_admin()) with check (id = current_org_id());
-- (inserts go through create_organization())

create policy "members read membership" on organization_members for select to authenticated
  using (org_id = current_org_id());
create policy "admins change roles" on organization_members for update to authenticated
  using (org_id = current_org_id() and is_org_admin() and role <> 'owner')
  with check (org_id = current_org_id() and role in ('admin','member'));
create policy "admins remove members" on organization_members for delete to authenticated
  using (org_id = current_org_id() and is_org_admin() and role <> 'owner');

create policy "admins manage invites" on organization_invites for all to authenticated
  using (org_id = current_org_id() and is_org_admin())
  with check (org_id = current_org_id() and is_org_admin() and role in ('admin','member'));

create policy "members read brands" on brands for select to authenticated using (org_id = current_org_id());
create policy "admins insert brands" on brands for insert to authenticated with check (org_id = current_org_id() and is_org_admin());
create policy "admins update brands" on brands for update to authenticated using (org_id = current_org_id() and is_org_admin()) with check (org_id = current_org_id());
create policy "admins delete brands" on brands for delete to authenticated using (org_id = current_org_id() and is_org_admin());

create policy "admins manage integrations" on org_integrations for all to authenticated
  using (org_id = current_org_id() and is_org_admin()) with check (org_id = current_org_id() and is_org_admin());
create policy "members read phone numbers" on phone_numbers for select to authenticated using (org_id = current_org_id());
create policy "admins write phone numbers" on phone_numbers for insert to authenticated with check (org_id = current_org_id() and is_org_admin());
create policy "admins update phone numbers" on phone_numbers for update to authenticated using (org_id = current_org_id() and is_org_admin()) with check (org_id = current_org_id());
create policy "admins delete phone numbers" on phone_numbers for delete to authenticated using (org_id = current_org_id() and is_org_admin());
create policy "members read purchases" on agent_purchases for select to authenticated using (org_id = current_org_id());
-- (agent_purchases are written by platform admins through the service role)

-- 4) Org-owned root tables: full access within your organization.
do $$
declare t text;
begin
  foreach t in array array[
    'campaigns_v2','listener_scripts','listener_handlers','listener_collections','knowledge_bases',
    'do_not_call','suppression_list','local_segments','ghost_runs','listener_qa_prompts','golden_eval_sets','campaigns'
  ] loop
    execute format(
      'create policy "org members" on %I for all to authenticated using (org_id = current_org_id()) with check (org_id = current_org_id())', t);
  end loop;
end $$;

-- 5) Child tables: scoped through the parent row.
create policy "org via campaign" on calls_v2 for all to authenticated
  using (campaign_id in (select id from campaigns_v2 where org_id = current_org_id()))
  with check (campaign_id in (select id from campaigns_v2 where org_id = current_org_id()));
create policy "org via campaign" on campaign_numbers_v2 for all to authenticated
  using (campaign_id in (select id from campaigns_v2 where org_id = current_org_id()))
  with check (campaign_id in (select id from campaigns_v2 where org_id = current_org_id()));
create policy "org via campaign" on sms_messages_v2 for all to authenticated
  using (campaign_id in (select id from campaigns_v2 where org_id = current_org_id()))
  with check (campaign_id in (select id from campaigns_v2 where org_id = current_org_id()));
create policy "org via campaign" on qa_scores for all to authenticated
  using (campaign_id in (select id from campaigns_v2 where org_id = current_org_id()))
  with check (campaign_id in (select id from campaigns_v2 where org_id = current_org_id()));
create policy "org via campaign" on qa_calibration for all to authenticated
  using (campaign_id in (select id from campaigns_v2 where org_id = current_org_id()))
  with check (campaign_id in (select id from campaigns_v2 where org_id = current_org_id()));
create policy "org via campaign" on listener_qa_analysis_runs for all to authenticated
  using (campaign_id in (select id from campaigns_v2 where org_id = current_org_id()))
  with check (campaign_id in (select id from campaigns_v2 where org_id = current_org_id()));
create policy "org via campaign" on listener_qa_batch_jobs for all to authenticated
  using (campaign_id in (select id from campaigns_v2 where org_id = current_org_id()))
  with check (campaign_id in (select id from campaigns_v2 where org_id = current_org_id()));
create policy "org via campaign" on prompt_versions for all to authenticated
  using (campaign_id in (select id from campaigns_v2 where org_id = current_org_id()))
  with check (campaign_id in (select id from campaigns_v2 where org_id = current_org_id()));
create policy "org via campaign" on scheduler_alert_state for all to authenticated
  using (campaign_id in (select id from campaigns_v2 where org_id = current_org_id()))
  with check (campaign_id in (select id from campaigns_v2 where org_id = current_org_id()));
create policy "org via campaign" on recurring_alert_state for all to authenticated
  using (parent_id in (select id from campaigns_v2 where org_id = current_org_id()))
  with check (parent_id in (select id from campaigns_v2 where org_id = current_org_id()));
create policy "org via campaign" on realtime_alert_state for all to authenticated
  using (child_campaign_id in (select id from campaigns_v2 where org_id = current_org_id()))
  with check (child_campaign_id in (select id from campaigns_v2 where org_id = current_org_id()));
create policy "org via campaign" on realtime_seen_members for all to authenticated
  using (parent_campaign_id in (select id from campaigns_v2 where org_id = current_org_id()))
  with check (parent_campaign_id in (select id from campaigns_v2 where org_id = current_org_id()));
create policy "org via call" on call_labels for all to authenticated
  using (call_id in (select c.id from calls_v2 c join campaigns_v2 p on p.id = c.campaign_id where p.org_id = current_org_id()))
  with check (call_id in (select c.id from calls_v2 c join campaigns_v2 p on p.id = c.campaign_id where p.org_id = current_org_id()));
create policy "org via call" on ghost_call_labels for all to authenticated
  using (call_id in (select c.id from calls_v2 c join campaigns_v2 p on p.id = c.campaign_id where p.org_id = current_org_id()))
  with check (call_id in (select c.id from calls_v2 c join campaigns_v2 p on p.id = c.campaign_id where p.org_id = current_org_id()));
create policy "org via set" on golden_eval_items for all to authenticated
  using (set_id in (select id from golden_eval_sets where org_id = current_org_id()))
  with check (set_id in (select id from golden_eval_sets where org_id = current_org_id()));
create policy "org via set" on golden_eval_runs for all to authenticated
  using (set_id in (select id from golden_eval_sets where org_id = current_org_id()))
  with check (set_id in (select id from golden_eval_sets where org_id = current_org_id()));
create policy "org via segment" on local_segment_numbers for all to authenticated
  using (segment_id in (select id from local_segments where org_id = current_org_id()))
  with check (segment_id in (select id from local_segments where org_id = current_org_id()));
create policy "org via script" on listener_script_nodes for all to authenticated
  using (script_id in (select id from listener_scripts where org_id = current_org_id()))
  with check (script_id in (select id from listener_scripts where org_id = current_org_id()));
create policy "org via script" on listener_script_edges for all to authenticated
  using (script_id in (select id from listener_scripts where org_id = current_org_id()))
  with check (script_id in (select id from listener_scripts where org_id = current_org_id()));
create policy "org via collection" on listener_collection_handlers for all to authenticated
  using (collection_id in (select id from listener_collections where org_id = current_org_id()))
  with check (collection_id in (select id from listener_collections where org_id = current_org_id()));
create policy "org via script" on lab_call_flow_state for all to authenticated
  using (script_id in (select id from listener_scripts where org_id = current_org_id()))
  with check (script_id in (select id from listener_scripts where org_id = current_org_id()));

-- Customer.io caches are keyed by workspace = brand slug.
create policy "org via brand" on cio_events for all to authenticated
  using (workspace in (select slug from brands where org_id = current_org_id()))
  with check (workspace in (select slug from brands where org_id = current_org_id()));
create policy "org via brand" on cio_messages for all to authenticated
  using (workspace in (select slug from brands where org_id = current_org_id()))
  with check (workspace in (select slug from brands where org_id = current_org_id()));
create policy "org via brand" on cio_track_events for all to authenticated
  using (workspace in (select slug from brands where org_id = current_org_id()))
  with check (workspace in (select slug from brands where org_id = current_org_id()));
create policy "org via brand" on cio_delivery_sync for all to authenticated
  using (workspace in (select slug from brands where org_id = current_org_id()))
  with check (workspace in (select slug from brands where org_id = current_org_id()));

-- v1 leftovers: dead code, deny everyone but the service role (no policy = no access).
-- (campaigns got org_id above so the v1 pages don't error; contacts has none.)

-- 6) Platform-level tables: readable by any signed-in user, written only by the service role.
create policy "signed-in read" on vapi_sip_pool for select to authenticated using (true);
create policy "signed-in read" on cron_heartbeats for select to authenticated using (true);
create policy "signed-in read" on alert_state for select to authenticated using (true);
-- Lab singletons and lab call logs stay shared until they are made per-organization.
create policy "signed-in all" on lab_settings for all to authenticated using (true) with check (true);
create policy "signed-in all" on listener_qa_schedule for all to authenticated using (true) with check (true);
create policy "signed-in all" on lab_call_events for all to authenticated using (true) with check (true);
-- Mobivate opt-outs hold phone numbers: service role only (SMS consent runs in cron/webhooks).

-- 7) Analytics functions: run as the caller so the policies above apply inside them.
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef
      and p.proname in ('campaign_roster_counts','audience_lane_reach','audience_lane_deposits','audience_lane_players',
                        'audience_lane_contact_effect','audience_lane_contact_window','audience_lane_last_touch',
                        'audience_lane_deposit_rollup','audience_lane_deposit_totals','audience_lane_reach_window',
                        'dashboard_call_rollup','dashboard_sms_rollup','estimate_rates_v1','get_audience_suggestions',
                        'campaign_spend_usd','cio_pull_queue','voizo_call_spoke_with','voizo_spoke_with','voizo_user_turns')
  loop
    execute format('alter function %s security invoker', r.sig);
  end loop;
end $$;

-- ── Bootstrap: the first organization for the existing admin account ────────
-- Puts admin@optinetsolutions.com in an "Optinet" organization as owner (if not already in one)
-- and adopts every existing org-less row into it, so nothing already created disappears.
do $$
declare v_uid uuid; v_org uuid; t text;
begin
  select id into v_uid from auth.users where lower(email) = 'admin@optinetsolutions.com' limit 1;
  if v_uid is null then return; end if;
  if not exists (select 1 from organization_members where user_id = v_uid) then
    insert into organizations (name, slug, created_by) values ('Optinet', 'optinet', v_uid)
      on conflict (slug) do nothing;
    select id into v_org from organizations where slug = 'optinet';
    insert into organization_members (org_id, user_id, role) values (v_org, v_uid, 'owner') on conflict do nothing;
  else
    select org_id into v_org from organization_members where user_id = v_uid;
  end if;
  foreach t in array array[
    'campaigns_v2','listener_scripts','listener_handlers','listener_collections','knowledge_bases',
    'do_not_call','suppression_list','local_segments','ghost_runs','listener_qa_prompts','golden_eval_sets','campaigns'
  ] loop
    execute format('update %I set org_id = $1 where org_id is null', t) using v_org;
  end loop;
end $$;

-- updated_at maintenance
create or replace function touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
do $$
declare t text;
begin
  foreach t in array array['organizations','brands','org_integrations'] loop
    execute format('drop trigger if exists %I on %I', t || '_touch', t);
    execute format('create trigger %I before update on %I for each row execute function touch_updated_at()', t || '_touch', t);
  end loop;
end $$;

-- Done. Verify with:  select count(*) from organizations;  select tablename, policyname from pg_policies where schemaname='public' order by 1,2;
