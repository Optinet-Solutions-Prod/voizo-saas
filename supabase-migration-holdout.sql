-- Migration: the deposit holdout. Adds campaigns_v2.holdout_pct and the 'holdout' outcome.
--
-- Why: every observational number Voizo has produced about "does calling a player make them
-- deposit" is confounded, because Voizo chooses who to call. Withholding a random share of the
-- players we WOULD have called is the only design that answers it. Design and sizing:
-- .agent/tasks/2026-09-08_TASK_deposit_holdout_design.md (approved 2026-09-09).
--
-- ORDER MATTERS, twice over:
--   1. Apply this to PROD *before* deploying the code that writes 'holdout'. Same rule as the
--      2026-06-19 call-observability migration and supabase-migration-sms-delivered-outcome.sql.
--      The new outcome list is a strict SUPERSET of the old one, so the re-added constraint
--      validates every existing row instantly and no in-flight write can be rejected.
--   2. Apply this, and deploy the code, BEFORE setting holdout_pct on any campaign. The column
--      defaults to 0 and at 0 the dialer skips the gate entirely, so nothing changes behaviour
--      until someone deliberately sets it. Setting it first, on old code, would do nothing at
--      all (the old dialer never reads the column) and would look like the holdout was running.
--
-- Deploying the code BEFORE this migration is survivable but wasteful: the dialer reads the
-- campaign row with select("*"), so a missing column reads as 0 and the gate stays inert. It
-- never errors and never stops dialling. That is the deliberate shape of the gate.
--
-- ROLLBACK is at the bottom, and note the asymmetry: dropping the column is safe any time,
-- but removing 'holdout' from the CHECK list requires that no row still carries it.

begin;

-- ── 1. The knob. 0 = off, and off is the default for every existing campaign. ──────────
alter table campaigns_v2
  add column if not exists holdout_pct int not null default 0;

alter table campaigns_v2
  drop constraint if exists campaigns_v2_holdout_pct_check;

-- 0-100 enforced in the database as well as in src/lib/holdout.ts. The code clamps a bad
-- value towards CALLING people (a NaN or a negative withholds nobody); the constraint stops
-- the bad value being stored in the first place. Belt and braces on a column whose failure
-- mode is "silently stopped phoning real customers".
alter table campaigns_v2
  add constraint campaigns_v2_holdout_pct_check
    check (holdout_pct >= 0 and holdout_pct <= 100);

comment on column campaigns_v2.holdout_pct is
  'Share of this campaign''s candidates withheld from all contact, 0-100, for the deposit '
  'holdout. 0 = off (default). Assignment is a stable hash of phone + parent campaign id '
  '(src/lib/holdout.ts), so a retry never re-flips the coin and a recurring child inherits '
  'the parent''s split. Withheld rows land in campaign_numbers_v2 with outcome = ''holdout''.';

-- ── 2. The outcome value for a withheld row. ───────────────────────────────────────────
-- Recorded rather than silently skipped so the arm can be counted later. Without this value
-- in the CHECK list the UPDATE fails with Postgres 23514 (check_violation) on every withheld
-- number — the dialer treats that as "leave them undialled" and logs, so it degrades safely,
-- but the arm goes unrecorded.
--
-- Wrapped in the transaction with the DROP/ADD pattern from
-- supabase-migration-rebuild-phase-1.sql:53-62, so concurrent writers block on the ALTER lock
-- rather than hitting a window where the constraint does not exist.
alter table campaign_numbers_v2
  drop constraint campaign_numbers_v2_outcome_check;

alter table campaign_numbers_v2
  add constraint campaign_numbers_v2_outcome_check
    check (outcome in (
      'pending', 'in_progress', 'unreached', 'pending_retry', 'sent_sms',
      'sms_delivered',
      'not_interested', 'declined_offer', 'wrong_number', 'suppressed',
      'removed_from_segment', 'recently_called_elsewhere',
      'holdout'
    ));

commit;

-- Verify after applying:
--   node scripts/_gate-0910-holdout-split.cjs
-- It proves the column exists with default 0, that the value 'holdout' is now accepted and a
-- junk value still rejected, and that the split the dialer would produce matches the requested
-- share on the real roster.

-- ── Rollback (manual) ─────────────────────────────────────────────────────────────────
-- The column drop is safe whenever. The CHECK revert is ONLY safe once no row carries
-- 'holdout' — check first:
--   select count(*) from campaign_numbers_v2 where outcome = 'holdout';
--
-- begin;
-- alter table campaigns_v2 drop constraint if exists campaigns_v2_holdout_pct_check;
-- alter table campaigns_v2 drop column if exists holdout_pct;
-- alter table campaign_numbers_v2
--   drop constraint campaign_numbers_v2_outcome_check;
-- alter table campaign_numbers_v2
--   add constraint campaign_numbers_v2_outcome_check
--     check (outcome in (
--       'pending', 'in_progress', 'unreached', 'pending_retry', 'sent_sms',
--       'sms_delivered',
--       'not_interested', 'declined_offer', 'wrong_number', 'suppressed',
--       'removed_from_segment', 'recently_called_elsewhere'
--     ));
-- commit;
