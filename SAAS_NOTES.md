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
- `DASHBOARD_USERNAME` / `DASHBOARD_PASSWORD` — admin login (see Auth)
- `VAPI_PRIVATE_KEY`, `NEXT_PUBLIC_VAPI_PUBLIC_KEY`, `VAPI_WEBHOOK_SECRET` — calling
- `OPENAI_API_KEY` — QA / analysis
- FreeSWITCH / Mobivate / Customer.io keys as those features are turned on

**Never commit real keys.** Use `.env.local` locally and host env vars in production.

## Admin auth
The whole app is gated by **HTTP Basic Auth** in `src/middleware.ts` using
`DASHBOARD_USERNAME` + `DASHBOARD_PASSWORD`. The browser prompts on first load.
If both are unset the middleware leaves the app open, so always set them.

## Status
- [x] Repo copied to `voizo-saas`
- [ ] Supabase schema provisioned (structure only)
- [ ] Env configured for the new project
- [ ] Calling providers wired (Vapi, etc.)
- No campaigns / data seeded (by design)
