/* _probe-0912-cio-app-keys.cjs — READ-ONLY. Does Lucky7even actually have a working App API key?
 *
 * The VOZ-479 design (2026-09-10) says "lucky7even: App API key MISSING", measured by reading
 * CUSTOMERIO_APP_API_KEYS alone. Jasiel says the key has been there since day one. Both can be
 * true: src/lib/customerio.ts resolveAppApiKey() falls back to the LEGACY singular
 * CUSTOMERIO_APP_API_KEY for the default workspace, and the default workspace IS lucky7even.
 *
 * Reading the env var is not proof the key works. This probe resolves each key the way the app
 * does, then makes real calls and reports what came back.
 *
 * Known-bad controls (an instrument with no self-test proves nothing):
 *   C1  a corrupted key must NOT return 200 on /v1/segments
 *   C2  a real key pointed at a cio_id from ANOTHER workspace must NOT return that person's data
 *
 * Usage: node scripts/_probe-0912-cio-app-keys.cjs
 */
const fs = require('fs');
const log = (s) => process.stdout.write(s + '\n');
const env = {};
for (const l of fs.readFileSync('C:/Users/jasin/Desktop/voizo/Voizo/.env.local', 'utf8').split(/\r?\n/)) {
  const i = l.indexOf('=');
  if (i > 0 && !l.startsWith('#')) env[l.slice(0, i).trim()] = l.slice(i + 1).trim().replace(/^["']|["']$/g, '');
}
const sb = { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: 'Bearer ' + env.SUPABASE_SERVICE_ROLE_KEY };
const API = 'https://api-eu.customer.io';
const DEFAULT_WORKSPACE = 'lucky7even'; // CIO_DEFAULT_WORKSPACE in src/lib/customerio.ts

/** Mirrors resolveAppApiKey() in src/lib/customerio.ts — map first, legacy fallback for default. */
function resolveAppApiKey(workspace) {
  let map = {};
  try { map = JSON.parse(env.CUSTOMERIO_APP_API_KEYS || '{}'); } catch { map = {}; }
  const ws = (workspace || '').trim() || DEFAULT_WORKSPACE;
  const fromMap = map[ws];
  if (typeof fromMap === 'string' && fromMap.trim()) return { key: fromMap.trim(), via: 'CUSTOMERIO_APP_API_KEYS' };
  if (ws === DEFAULT_WORKSPACE && env.CUSTOMERIO_APP_API_KEY) {
    return { key: env.CUSTOMERIO_APP_API_KEY, via: 'CUSTOMERIO_APP_API_KEY (legacy singular)' };
  }
  return { key: null, via: null };
}

const fp = (k) => (k ? k.slice(0, 4) + '…' + k.slice(-2) + ' (len ' + k.length + ')' : '—');

async function cio(key, path) {
  const t0 = Date.now();
  const r = await fetch(API + path, { headers: { Authorization: 'Bearer ' + key } });
  const text = await r.text();
  let body; try { body = JSON.parse(text); } catch { body = text.slice(0, 200); }
  return { status: r.status, ms: Date.now() - t0, body };
}

async function sbGet(path) {
  const r = await fetch(env.NEXT_PUBLIC_SUPABASE_URL + '/rest/v1/' + path, { headers: sb });
  if (!r.ok) throw new Error(path.slice(0, 60) + ' -> ' + r.status + ' ' + (await r.text()).slice(0, 200));
  return r.json();
}

(async () => {
  log('=== 1. What the env actually holds (no secrets printed) ===');
  const workspaces = ['lucky7even', 'fortuneplay', 'roosterbet'];
  const resolved = {};
  for (const ws of workspaces) {
    const r = resolveAppApiKey(ws);
    resolved[ws] = r;
    log(`  ${ws.padEnd(12)} ${r.key ? fp(r.key) : 'NO KEY'}   via ${r.via || '—'}`);
  }

  // NB 2026-09-12: /v1/accounts/region 404s for EVERY key including a corrupted one, so a control
  // run against it "passes" while proving nothing. The App API prefix is /api/v1.
  log('\n=== 2. Is each key LIVE? GET /api/v1/accounts/region ===');
  const liveStatus = {};
  for (const ws of workspaces) {
    const { key } = resolved[ws];
    if (!key) { log(`  ${ws.padEnd(12)} SKIPPED — no key`); continue; }
    const r = await cio(key, '/v1/segments');
    liveStatus[ws] = r.status;
    const segs = Array.isArray(r.body && r.body.segments) ? r.body.segments.length : null;
    log(`  ${ws.padEnd(12)} HTTP ${r.status} (${r.ms} ms)  ` +
        (segs === null ? JSON.stringify(r.body).slice(0, 120) : `${segs} segments visible`));
  }

  log('\n=== C1 known-bad control: a corrupted key must NOT get what a real key gets ===');
  const goodWs = workspaces.find((w) => liveStatus[w] === 200);
  if (!goodWs) {
    log('  *** CONTROL INCONCLUSIVE: no key returned 200, so there is no "good" result to contrast. ***');
  } else {
    const bad = resolved[goodWs].key.slice(0, -4) + 'zzzz';
    const c1 = await cio(bad, '/v1/segments');
    log(`  real key (${goodWs}) -> HTTP 200,  corrupted -> HTTP ${c1.status}`);
    log(c1.status === 200
      ? '  *** CONTROL FAILED: the endpoint answers anything. Nothing below is evidence. ***'
      : '  OK, control discriminates: 200 means the key is genuinely accepted.');
  }

  log('\n=== 3. Does each key return MESSAGES for a real Voizo-contacted player? ===');
  // campaigns_v2.cio_workspace is the routing label; NULL means the default workspace (lucky7even).
  const now = Math.floor(Date.now() / 1000);
  const start = now - 30 * 86400;
  const picked = {};
  for (const ws of workspaces) {
    const wsFilter = ws === DEFAULT_WORKSPACE
      ? '&campaigns_v2.or=(cio_workspace.eq.lucky7even,cio_workspace.is.null)'
      : `&campaigns_v2.cio_workspace=eq.${ws}`;
    const rows = await sbGet(
      'campaign_numbers_v2?select=cio_id,phone_e164,last_attempted_at,campaigns_v2!inner(cio_workspace)' +
      '&cio_id=not.is.null&last_attempted_at=not.is.null&order=last_attempted_at.desc&limit=1' + wsFilter,
    );
    const row = rows[0];
    picked[ws] = row || null;
    if (!row) { log(`  ${ws.padEnd(12)} no contacted player with a cio_id found`); continue; }
    const { key } = resolved[ws];
    if (!key) { log(`  ${ws.padEnd(12)} SKIPPED — no key`); continue; }
    const r = await cio(key, `/v1/customers/${row.cio_id}/messages?id_type=cio_id&limit=10&start_ts=${start}&end_ts=${now}`);
    const n = Array.isArray(r.body && r.body.messages) ? r.body.messages.length : null;
    log(`  ${ws.padEnd(12)} cio_id ${String(row.cio_id).slice(0, 8)}…  HTTP ${r.status} (${r.ms} ms)  ` +
        (n === null ? JSON.stringify(r.body).slice(0, 160) : `${n} message(s) in 30d`));
  }

  log('\n=== C2 known-bad control: a key must NOT answer for another workspace\'s person ===');
  const a = workspaces.find((w) => resolved[w].key && picked[w]);
  const b = workspaces.find((w) => w !== a && resolved[w].key && picked[w]);
  if (!a || !b) {
    log('  *** CONTROL INCONCLUSIVE: need two workspaces with both a key and a player. ***');
  } else {
    const r = await cio(resolved[a].key, `/v1/customers/${picked[b].cio_id}/messages?id_type=cio_id&limit=10&start_ts=${start}&end_ts=${now}`);
    const n = Array.isArray(r.body && r.body.messages) ? r.body.messages.length : null;
    log(`  ${a}'s key asked about ${b}'s player -> HTTP ${r.status}, ${n === null ? 'no messages array' : n + ' message(s)'}`);
    log(r.status === 200 && n > 0
      ? '  *** CONTROL FAILED: keys are not workspace-scoped, so a 200 above proves nothing about WHICH workspace. ***'
      : '  OK, control discriminates: each key only answers for its own workspace.');
  }
  log('\n=== 4. Paging: does `next` appear at limit=100? (the budget rests on this) ===');
  for (const ws of workspaces) {
    const row = picked[ws]; const { key } = resolved[ws];
    if (!row || !key) continue;
    let url = `/v1/customers/${row.cio_id}/messages?id_type=cio_id&limit=100&start_ts=${start}&end_ts=${now}`;
    let total = 0, pages = 0, next = null;
    do {
      const r = await cio(key, url + (next ? `&start=${encodeURIComponent(next)}` : ''));
      if (r.status !== 200) { log(`  ${ws.padEnd(12)} HTTP ${r.status} mid-page, stopping`); break; }
      total += (r.body.messages || []).length; pages++;
      next = r.body.next || null;
      url = `/v1/customers/${row.cio_id}/messages?id_type=cio_id&limit=100&start_ts=${start}&end_ts=${now}`;
    } while (next && pages < 20);
    log(`  ${ws.padEnd(12)} ${total} messages in 30d across ${pages} page(s); next ${next ? 'STILL SET (capped)' : 'null'}`);
  }
})().catch((e) => { log('FATAL ' + e.message); process.exit(1); });
