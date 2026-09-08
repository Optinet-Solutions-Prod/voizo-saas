-- Mobivate reconcile (2026-09-07): close unconfirmed texts to Mobivate's final word, keep the
-- cost per text, and mirror Mobivate's opt-out list so the SMS path skips numbers it would drop.
--
-- Why: a text Mobivate refuses at the door (OPTED_OUT, LIMITS_EXCEEDED, REJECTED) never gets a
-- delivery receipt, so our row sits at status='sent' forever. Measured 2026-09-07: 37 of our 42
-- 'sent' rows in the last 20 days were OPTED_OUT; 552 of 906 all-time 'sent' rows went to numbers
-- on Mobivate's opt-out list (1,464 of them dead numbers under Mobivate's "3x UNDELIVERABLE" rule).
--
-- DEPLOY ORDER (hard requirement): run this BEFORE the code ships. The reconcile UPDATE names
-- price_eur/parts/reconciled_at and the SMS gate SELECTs mobivate_optouts; a missing column fails
-- the UPDATE, a missing table makes the gate fail closed and no text goes out.

alter table public.sms_messages_v2
  add column if not exists price_eur numeric(10,4),
  add column if not exists parts smallint,
  add column if not exists reconciled_at timestamptz;

comment on column public.sms_messages_v2.price_eur is 'Mobivate price for this text in EUR, from /messages/history (null until reconciled or when the account currency is not EUR).';
comment on column public.sms_messages_v2.parts is 'Mobivate segment count for this text, from /messages/history.';
comment on column public.sms_messages_v2.reconciled_at is 'When the nightly reconcile last read a FINAL word for this row from Mobivate.';

create table if not exists public.mobivate_optouts (
  phone_e164 text primary key,
  listed_at  timestamptz,
  reason     text,                       -- Mobivate's note verbatim, null when the API omits it
  kind       text not null,              -- dead_number | player_opt_out | crm_pasted | unknown
  synced_at  timestamptz not null
);
create index if not exists mobivate_optouts_synced_at_idx on public.mobivate_optouts (synced_at);

comment on table public.mobivate_optouts is 'Mirror of Mobivate''s opt-out list (GET /addressbook/optouts), refreshed nightly by /api/cron/mobivate-reconcile. Read by the SMS gate; never by the dialer (player_opt_out rows are ALSO written to suppression_list, which the dialer reads).';

-- Rollback (only with the code reverted):
-- drop table if exists public.mobivate_optouts;
-- alter table public.sms_messages_v2 drop column if exists price_eur, drop column if exists parts, drop column if exists reconciled_at;
