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

## Organizations, brands, members (Phase 2, 2026-09-24)
**One-time step: run `supabase-migration-saas-tenancy.sql` in the Supabase SQL editor.**
Until it has run, the console detects the missing tables and keeps working in the old
single-workspace mode (Settings shows a notice). After it runs, everything below is live
with no redeploy: the app re-probes every minute.

- **Model**: `organizations` → `organization_members` (role owner | admin | member, one org per
  user) → `brands` (name, globally-unique slug, colour). `organization_invites` carry a token
  link (14 days). Owners/admins manage the org, members, invites and brands; members use the
  console. `app_metadata.role = "admin"` on an auth user = VOIZO platform staff.
- **Isolation**: every org-owned table has `org_id` (default `current_org_id()`), child tables are
  scoped through their campaign/script/set, and all `using (true)` policies were replaced.
  `supabaseAdmin` now sends the signed-in user's JWT (so those policies apply) and falls back to
  the service role for cron/webhooks. Analytics functions run as the caller (SECURITY INVOKER).
  Known shared tables: `lab_settings`, `listener_qa_schedule`, `lab_call_events` (lab singletons).
- **Brands** replace the hard-coded Lucky7even/Fortune Play/Roosterbet list: the sidebar switcher
  lists the org's brands, `brandLabel()` reads them, and the campaign wizard has a Brand select
  stored as `campaigns_v2.cio_workspace` (the same label SMS/Customer.io key on).
- **Flows**: `/signup` → email confirmation → `/onboarding` (create an org, or accept the invite
  sent to that email). `/invite/<token>` for invited people. `/settings` has Organization,
  Members (+ invites, with the link shown for hand sharing when Resend isn't configured) and Brands.
- **Bootstrap**: the migration makes `admin@optinetsolutions.com` owner of an "Optinet"
  organization and adopts all pre-existing rows into it.

## Integrations & phone numbers (Phase 3, 2026-09-24)
Settings → Integrations: each organization stores its own credentials for Customer.io,
Squaretalk, FreeSWITCH (shim), OpenAI, Mobivate, Twilio, Resend, Brevo and ElevenLabs.
Secrets are AES-256-GCM encrypted in `org_integrations.credentials`
(`src/lib/integrations/crypto.ts`); set **`INTEGRATIONS_ENCRYPTION_KEY`** in Vercel (any long
random string). Without it the key is derived from the service-role key, which works but ties
stored credentials to that key. "Save & test" makes one read-only call to the provider
(`src/lib/integrations/providers.ts`). Squaretalk and Mobivate have no public account endpoint,
so their tests check reachability and key rejection only.
Settings → Phone numbers: caller IDs per org (+ optional brand). Twilio numbers are verified
against the connected account; FreeSWITCH/Squaretalk check the connection; others format only.
Server code reads an org's credentials with `getOrgIntegration(orgId, provider)`
(`src/lib/integrations/store.ts`). The call pipeline still reads the env vars; switching it to
per-org credentials is part of the later dialing work.

## ElevenLabs voices (Phase 4, 2026-09-24)
Once an organization connects ElevenLabs (Settings → Integrations), its own voices appear in
the script builder's voice picker under "Your ElevenLabs voices" (`/api/org/voices`, cached 5
min). Assistants that use such a voice get the org's ElevenLabs key attached inline as a Vapi
assistant credential (`credentials: [{ provider: "11labs", apiKey }]`) — on campaign clones,
rebinds, daily spawns and the lab assistant — so Vapi can synthesise a voice that isn't in
VOIZO's own ElevenLabs account. `voiceCloneExtras(orgId)` in `src/lib/voices/orgVoices.ts`.

## Pre-built agents (Phase 5, 2026-09-24)
`src/lib/agents/catalog.ts` holds 20 agents (name, role, industry, persona, full call flow,
voice, sample text, price). **Free:** Ava (appointment reminder), Leo (lead qualifier), Maya
(satisfaction survey). The other 17 are $19 / €18 one-time per organization (or included in
Pro/Scale) and are unlocked by VOIZO staff in Settings → Platform (`agent_purchases`; no card
checkout yet, per Chris's decision).
- **Landing / `/agents`:** every agent has a ~20 s sample clip in the public Storage bucket
  `agent-samples` (`<key>.mp3`). Generated with `node scripts/generate-agent-samples.mjs` —
  currently OpenAI TTS (gpt-4o-mini-tts). **Chris wanted ElevenLabs:** set `ELEVENLABS_API_KEY`
  in `.env.local` and run `node scripts/generate-agent-samples.mjs --provider elevenlabs --force`;
  it then uses each agent's own library voice.
- **In-app:** Script Builder → "Agent templates" (`/script-builder/templates`). "Add to my
  agents" creates a real script in the org: Playbook scenarios for every line (group
  "<Name> — <Role>"), a graph Start → Opening → Reason → replies → SMS → Goodbye → End, a Call
  Goal box, the persona and the voice (`src/lib/agents/install.ts`). Placeholders like
  `{{company}}`, `{{first_name}}`, `{{link}}` are left for the operator to fill.

## Pricing (Phase 6, 2026-09-24)
`src/lib/pricing.ts` + public `/pricing` (USD/EUR and monthly/yearly toggles) + the Plan card in
Settings → Organization. Display only — no Stripe (Chris's decision); VOIZO staff set a plan in
Settings → Platform (`organizations.plan`). Plans: Free $0 (60 min, 3 free agents) · Starter
$49/€45 (500 min, $0.15/min extra) · Pro $149/€139 (2,000 min, $0.12, all 20 agents, own
ElevenLabs voices, QA judge) · Scale $449/€419 (8,000 min, $0.10, BYO telephony, SLA). Yearly
≈15% off. Paid agents $19/€18 one-off on Free/Starter, included on Pro/Scale. Research basis is
in the file header (Bland, Retell, Vapi, Autocalls, Goodcall, Sept 2026). Minute metering and
overage billing are not implemented; the numbers are the offer, not enforced limits.

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
