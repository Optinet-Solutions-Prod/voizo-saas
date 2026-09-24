# Voizo SaaS — fork notes

A copy of the internal Voizo dialer/dashboard, being adapted into a multi-tenant SaaS.

## Origin
- Forked from `optinet-solutions-sandbx/Voizo` @ `808b10d` on 2026-09-14.
- Lives at `Optinet-Solutions-Prod/voizo-saas`.

## Supabase (new, dedicated project)
- URL: `https://imnjvtiueyoeouyhomav.supabase.co` (ref `imnjvtiueyoeouyhomav`, region ap-northeast-1).
- Fresh project — **no production data or call history copied**.
- Schema: provisioned as **structure only**. Data starts empty (no campaigns, no calls).

## Environment (`.env.local` — never committed; set in the deployment host)
Minimum to boot + place a call:
- `NEXT_PUBLIC_SUPABASE_URL=https://imnjvtiueyoeouyhomav.supabase.co`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY=` — Supabase → Settings → API (browser-safe)
- `SUPABASE_SERVICE_ROLE_KEY=` — Supabase → Settings → API (server-only, secret)
- `VAPI_WEBHOOK_URL` — this deployment's `/api/webhooks/vapi/end-of-call` (unset = falls back to the old prod host)
- `VAPI_PRIVATE_KEY`, `NEXT_PUBLIC_VAPI_PUBLIC_KEY`, `VAPI_WEBHOOK_SECRET` — calling
- `OPENAI_API_KEY` — QA / analysis
- FreeSWITCH / Mobivate / Customer.io keys as those features are turned on

**Never commit real keys.** Use `.env.local` locally and host env vars in production.

## Admin auth
Supabase Auth (email + password). `/` (landing) and `/login` are public; everything else
needs a signed-in user whose **`app_metadata.role` is `"admin"`**, checked in
`src/middleware.ts` (pages redirect to `/login?next=…`, `/api/*` returns 401). Webhook, cron
and lab-webhook routes stay public and check their own secrets.

- Add an admin: Supabase → Authentication → Users → Add user (auto-confirm), then set
  `app_metadata` to `{"role":"admin"}`. Or POST `/auth/v1/admin/users` with the service role
  key and `"app_metadata":{"role":"admin"}`. app_metadata can only be set with the service
  role, so a self-signup never gets in.
- Turn off public sign-ups: Authentication → Sign In / Providers → "Allow new users to sign up".
- `DASHBOARD_USERNAME` / `DASHBOARD_PASSWORD` (the old Basic Auth pair) are no longer read.
- Browser data queries still use the plain anon client (`src/lib/supabase.ts`), not the
  user's session, because the RLS policies were written for the anon role.

## Vercel crons (removed for now)
All crons were removed from `vercel.json` for the first deploy (agent/UI testing only; the
every-minute ones need Vercel Pro). Restore from git history (`git show 4029b52:vercel.json`)
when calling goes live. The set was:
- `* * * * *` campaign-scheduler, realtime-poll
- `*/5 * * * *` recording-backfill · `*/30 * * * *` campaign-heartbeat, score-backfill
- `15 * * * *` alerts-hourly · `0 */3 * * *` qa-import-sweep
- daily: stuck-slot-watchdog (09:00), golden-replay (09:30), daily-snapshot (07:00),
  qa-analysis-daily (06:00), mobivate-reconcile (04:20), cio-message-pull (05:10)

## Status
- [x] Repo copied to `voizo-saas`
- [x] Supabase schema provisioned (structure only)
- [ ] Env configured for the new project
- [ ] Calling providers wired (Vapi, etc.)
- No campaigns / data seeded (by design)
