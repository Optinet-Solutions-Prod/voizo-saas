-- VOZ-479 — the nightly Customer.io message pull.
-- Design: .agent/tasks/2026-09-10_DESIGN_VOZ479_cio_nightly_pull.md (§1 withdrawn 2026-09-12).
-- Pattern: new tables + default-deny RLS, exactly like cio_events / realtime_seen_members / qa_scores.
--
-- APPLY THIS BEFORE THE ROUTE SHIPS, or every upsert 500s.
-- Apply to voizo-sandbox (staging) FIRST, confirm, then prod.
--
-- WHY: Voizo cannot see what the CRM sent a player. That blindness is why both contact-to-deposit
-- lift measurements (25 Aug, 8 Sep) could not separate our call from the email the CRM sent an hour
-- earlier, why Gisela's pre-call-SMS question took a day to answer on 08 Sep, and why the holdout
-- cannot yet be described honestly as "Voizo contact ON TOP OF CRM activity". This table is what
-- the CRM sent. cio_events (deposits) and cio_track_events (what we sent) are different things and
-- are not touched.
--
-- NOT URGENT, unlike cio_events: measured 2026-09-12, /v1/customers/{id}/messages serves 183 days
-- of history on demand (scripts/_probe-0912-cio-message-retention.cjs), so nothing perishes while
-- this waits. cio_events had to ship the day it was designed; this does not.

-- ── 1. what the CRM sent ────────────────────────────────────────────────────────────────────────
create table if not exists public.cio_messages (
  -- The CRM workspace this came from. A cio_id is workspace-scoped: asking the wrong workspace's
  -- key about it returns 404 (verified, control C2 in _probe-0912-cio-app-keys.cjs), so the pair is
  -- the identity. Measured: 0 of 15,022 cio_ids are claimed by two workspaces.
  workspace        text not null,
  -- Customer.io's opaque person id. NEVER the phone: one phone carries several CRM accounts
  -- (77 in the last 30 days, 836 all-time), and keying on phone is the bug that undercounted
  -- money on 08 Sep.
  cio_id           text not null,
  message_id       text not null,           -- Customer.io's own `id`
  -- DELIBERATELY UNCONSTRAINED. Customer.io owns this vocabulary, not us. The design guessed
  -- "email | sms | push | in_app | webhook"; a 526-message probe on 2026-09-12 actually returned
  -- email, in_app, webhook and `inbox`. A check constraint here would fail the whole upsert the
  -- day Customer.io ships a new channel, which is the worst possible time to find out.
  type             text,
  campaign_id      integer,                 -- null on a broadcast or transactional send
  broadcast_id     integer,
  newsletter_id    integer,
  msg_template_id  integer,
  action_id        integer,
  content_id       integer,
  -- CRM copy, no recipient and no identifiers. Useful for reading a timeline.
  subject          text,
  -- The epoch map, stored whole (D2 — there is no `state` field on a message). Sanitised to
  -- NUMERIC VALUES ONLY in toMessageRow(), so nothing identifying can ever arrive here by accident.
  -- Holds far more than the columns below: human_opened, prefetch_opened, undeliverable,
  -- unsubscribed, secondary:delivered, and one link:<id> / human_link:<id> stamp per clicked link.
  metrics          jsonb not null default '{}'::jsonb,
  -- Derived from `metrics` so the common questions are indexable. A missing key stays NULL and is
  -- NEVER coerced to a zero or an epoch-0 date: 11 of 526 probed messages carry no `metrics.sent`.
  sent_at          timestamptz,
  delivered_at     timestamptz,
  -- ⚠ USE human_opened_at FOR ANY OPEN RATE. `opened` counts machines: measured 2026-09-12 over
  -- 434 real emails, 69 carry `opened` and only 41 carry `human_opened`, so 28 opens (41%) never
  -- involved a person and the rate reads 15.9% instead of 9.4% — a 1.7x overstatement, which is
  -- Apple Mail Privacy Protection prefetching (37 of those rows also carry `prefetch_opened`).
  -- On the 34 rows carrying both, `opened` is the EARLIER stamp, so the timing is wrong too.
  -- opened_at is kept because machine opens are real deliverability signal, but it is not
  -- engagement. `clicked` needs no twin: 0 divergence from human_clicked over the same rows.
  opened_at        timestamptz,
  human_opened_at  timestamptz,
  clicked_at       timestamptz,
  converted_at     timestamptz,             -- D8
  failed_at        timestamptz,             -- D8
  failure_message  text,
  -- Customer.io's own creation stamp, NOT ours. Named cio_created_at rather than the design's
  -- `created` so nobody reads it as "when our row was written" — that is pulled_at.
  cio_created_at   timestamptz,
  pulled_at        timestamptz not null,
  -- Metrics keep changing after the send: a message pulled tonight as `sent` is `opened` tomorrow.
  -- Every pull re-reads a trailing window and overwrites on this key.
  primary key (workspace, message_id)
);

alter table public.cio_messages enable row level security;
-- default-deny: no policies. Server-side access uses the service role.

-- Read paths: "this player's CRM timeline" and "what the CRM sent in this window".
create index if not exists cio_messages_cio_id_idx  on public.cio_messages (cio_id);
create index if not exists cio_messages_sent_at_idx on public.cio_messages (sent_at desc);

comment on table public.cio_messages is
  'What the CRM sent a Voizo-contacted player, pulled nightly from the Customer.io App API by /api/cron/cio-message-pull. NEVER stores recipient or customer_identifiers (both present on 100% of API responses) — the join key is cio_id. Sibling tables: cio_events = deposits in, cio_track_events = what Voizo sent out.';
comment on column public.cio_messages.opened_at is
  'From metrics.opened, which INCLUDES machine opens (Apple MPP, scanners). Measured 2026-09-12: 41% of opens are machine-only, so this reads 1.7x the real rate. For engagement use human_opened_at.';
comment on column public.cio_messages.human_opened_at is
  'From metrics.human_opened — a person actually opened it. THIS is the open rate. Added 2026-09-12 after opened_at was measured at 15.9% against this column''s 9.4% over 434 emails.';
comment on column public.cio_messages.metrics is
  'Customer.io''s epoch-seconds map, numeric values only. Richer than the derived columns: human_opened, human_clicked, prefetch_opened, undeliverable, unsubscribed, attempted, drafted, processed, secondary:delivered, secondary:failed, and link:<id> per clicked link.';

-- ── 2. the job's own state ──────────────────────────────────────────────────────────────────────
create table if not exists public.cio_delivery_sync (
  workspace       text not null,
  cio_id          text not null,
  last_pulled_at  timestamptz,              -- when we last ASKED (stamped on failure too, or the
                                            -- queue returns the same rows forever inside one night)
  last_message_at timestamptz,              -- newest message seen, drives the trailing overlap
  -- The earliest Voizo attempt for this account WITHIN THE QUEUE WINDOW — not lifetime first
  -- contact. Used only to choose the first pull's start_ts (contacted_at - 7 days), so we see the
  -- CRM activity that PRECEDED our call.
  contacted_at    timestamptz,
  attempts        integer not null default 0,
  last_error      text,                     -- so a permanently failing account is visible rather
                                            -- than retried forever in silence
  primary key (workspace, cio_id)
);

alter table public.cio_delivery_sync enable row level security;

-- The queue is ordered by this, nulls first.
create index if not exists cio_delivery_sync_last_pulled_at_idx
  on public.cio_delivery_sync (last_pulled_at asc nulls first);

comment on table public.cio_delivery_sync is
  'Per (workspace, cio_id) state for the nightly Customer.io message pull. One row per CRM account Voizo has contacted, not per phone.';

-- ── 3. the queue ────────────────────────────────────────────────────────────────────────────────
-- Built in SQL, not TypeScript: the two source tables are 61k and 24k rows, and paging them over
-- PostgREST every night would cost ~45 round trips out of a 270-second budget.
--
-- TWO SOURCES, deliberately. Measured 2026-09-12 over 13,865 phones attempted in 30 days:
-- campaign_numbers_v2.cio_id resolves 4,714 of them and realtime_seen_members resolves 9,151 more,
-- with ZERO resolved by neither. Using campaign_numbers_v2 alone would cover a third of contacted
-- players and under-represent lucky7even by 10x (475 accounts instead of 5,121) without saying so.
drop function if exists public.cio_pull_queue(integer, integer);
create function public.cio_pull_queue(
  p_days  integer default 30,
  p_limit integer default 1000
)
returns table (
  workspace       text,
  cio_id          text,
  contacted_at    timestamptz,
  last_pulled_at  timestamptz,
  last_message_at timestamptz,
  attempts        integer
)
language sql stable as $$
  with attempted as (
    -- Earliest attempt per phone INSIDE the window. min(), not max(): the first pull wants the
    -- CRM activity that preceded our first call, not our most recent one.
    select cn.phone_e164, min(cn.last_attempted_at) as contacted_at
    from public.campaign_numbers_v2 cn
    where cn.last_attempted_at >= now() - make_interval(days => p_days)
    group by cn.phone_e164
  ),
  accounts as (
    select coalesce(c.cio_workspace, 'lucky7even') as workspace, cn.cio_id, a.contacted_at
    from public.campaign_numbers_v2 cn
    join attempted a on a.phone_e164 = cn.phone_e164
    join public.campaigns_v2 c on c.id = cn.campaign_id
    where cn.cio_id is not null
    union
    select coalesce(c.cio_workspace, 'lucky7even'), r.cio_id, a.contacted_at
    from public.realtime_seen_members r
    join attempted a on a.phone_e164 = r.phone_e164
    join public.campaigns_v2 c on c.id = r.parent_campaign_id
    where r.cio_id is not null
  )
  select acc.workspace,
         acc.cio_id,
         min(acc.contacted_at) as contacted_at,
         s.last_pulled_at,
         s.last_message_at,
         coalesce(s.attempts, 0) as attempts
  from accounts acc
  left join public.cio_delivery_sync s
    on s.workspace = acc.workspace and s.cio_id = acc.cio_id
  group by acc.workspace, acc.cio_id, s.last_pulled_at, s.last_message_at, s.attempts
  -- New accounts first, then the stalest. The job stamps last_pulled_at on every outcome, so
  -- re-calling this after each batch walks forward instead of looping on the same rows.
  order by s.last_pulled_at asc nulls first, acc.cio_id
  limit p_limit;
$$;

comment on function public.cio_pull_queue(integer, integer) is
  'The nightly Customer.io pull queue: distinct (workspace, cio_id) for every CRM account behind a phone Voizo attempted in the last p_days, oldest-pulled first. Union of campaign_numbers_v2.cio_id and realtime_seen_members.cio_id — neither source alone is complete.';

-- Supporting indexes for the queue scan. Both are additive and safe to re-run.
create index if not exists campaign_numbers_v2_last_attempted_at_idx
  on public.campaign_numbers_v2 (last_attempted_at desc);
create index if not exists realtime_seen_members_phone_e164_idx
  on public.realtime_seen_members (phone_e164);

-- Applied separately to the live project on 2026-09-12, and folded into the table above so a
-- fresh apply matches. Kept here because re-running it is harmless and it backfills from the
-- `metrics` map we already store — no Customer.io re-read is needed, which is the whole payoff of
-- storing the map whole:
--   alter table public.cio_messages add column if not exists human_opened_at timestamptz;
--   update public.cio_messages
--      set human_opened_at = to_timestamp((metrics->>'human_opened')::bigint)
--    where metrics ? 'human_opened' and human_opened_at is null;

-- ── Verify (paste after applying) ───────────────────────────────────────────────────────────────
--   select table_name from information_schema.tables
--    where table_name in ('cio_messages','cio_delivery_sync');          -- expect 2 rows
--   select count(*) from cio_messages;                                  -- 0 until the first run
--   select count(*) from cio_pull_queue(30, 100000);                    -- ~15,000 on 2026-09-12
--   explain analyze select * from cio_pull_queue(30, 1000);             -- must be well under 8s
--   -- the queue must never hand back a null key:
--   select count(*) from cio_pull_queue(30, 100000)
--    where workspace is null or cio_id is null;                         -- expect 0

-- ── Rollback (only with the code reverted) ──────────────────────────────────────────────────────
--   drop function if exists public.cio_pull_queue(integer, integer);
--   drop table if exists public.cio_messages;
--   drop table if exists public.cio_delivery_sync;
--   -- the two indexes above are harmless; drop only if you want the tables untouched:
--   -- drop index if exists public.campaign_numbers_v2_last_attempted_at_idx;
--   -- drop index if exists public.realtime_seen_members_phone_e164_idx;
