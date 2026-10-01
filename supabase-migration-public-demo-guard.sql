-- Public demo guard: durable rate limits for the landing-page endpoints (/api/public/*).
-- Rows are counted per (kind, hashed IP) in a sliding window and per kind per day; the app
-- falls back to a per-instance memory limiter until this table exists.
-- Run in the Supabase SQL editor. Safe to re-run.

create table if not exists public_demo_requests (
  id          bigserial primary key,
  kind        text not null,            -- call | match | summary
  ip_hash     text not null,            -- sha256(secret:ip), never the raw address
  agent_key   text,
  created_at  timestamptz not null default now()
);

create index if not exists public_demo_requests_kind_ip_idx on public_demo_requests (kind, ip_hash, created_at desc);
create index if not exists public_demo_requests_kind_created_idx on public_demo_requests (kind, created_at desc);

-- Service role only: RLS on, no policies.
alter table public_demo_requests enable row level security;

-- Housekeeping: nothing older than 7 days is ever read.
create or replace function public_demo_requests_prune() returns void language sql security definer set search_path = public as $$
  delete from public_demo_requests where created_at < now() - interval '7 days';
$$;
