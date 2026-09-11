/* _probe-0912-cio-message-retention.cjs — READ-ONLY. How far back does /messages actually go?
 *
 * This decides whether holding VOZ-479 is free or expensive. cio_events was built because the
 * Customer.io ACTIVITIES window is ~30 days and rolls strictly — "one day of player history is
 * lost per day this is not live" (supabase-migration-cio-events.sql). If /messages rolls the same
 * way, every night the nightly pull does not run is a night of CRM history gone for good, and
 * "keep it on the worktree for a while" has a real price.
 *
 * If instead /messages serves the full history on demand, holding costs nothing and the job can
 * backfill whenever it ships.
 *
 * Asks ONE Voizo-contacted player per workspace, over widening windows, and reports the oldest
 * message each window returns. Read-only, no writes anywhere.
 *
 * Usage: node scripts/_probe-0912-cio-message-retention.cjs
 */
const fs = require('fs');
const log = (s) => process.stdout.write(s + '\n');
const env = {};
for (const l of fs.readFileSync('C:/Users/jasin/Desktop/voizo/Voizo/.env.local', 'utf8').split(/\r?\n/)) {
  const i = l.indexOf('=');
  if (i > 0 && !l.startsWith('#')) env[l.slice(0, i).trim()] = l.slice(i + 1).trim().replace(/^["']|["']$/g, '');
}
const h = { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: 'Bearer ' + env.SUPABASE_SERVICE_ROLE_KEY };
const API = 'https://api-eu.customer.io';
const DEFAULT_WORKSPACE = 'lucky7even';

function resolveAppApiKey(workspace) {
  let map = {};
  try { map = JSON.parse(env.CUSTOMERIO_APP_API_KEYS || '{}'); } catch { map = {}; }
  const ws = (workspace || '').trim() || DEFAULT_WORKSPACE;
  if (typeof map[ws] === 'string' && map[ws].trim()) return map[ws].trim();
  if (ws === DEFAULT_WORKSPACE && env.CUSTOMERIO_APP_API_KEY) return env.CUSTOMERIO_APP_API_KEY;
  return null;
}

async function cio(key, path) {
  const r = await fetch(API + path, { headers: { Authorization: 'Bearer ' + key } });
  const text = await r.text();
  try { return { status: r.status, body: JSON.parse(text) }; } catch { return { status: r.status, body: text.slice(0, 200) }; }
}

async function sbGet(path) {
  const r = await fetch(env.NEXT_PUBLIC_SUPABASE_URL + '/rest/v1/' + path, { headers: h });
  if (!r.ok) throw new Error(path.slice(0, 60) + ' -> ' + r.status + ' ' + (await r.text()).slice(0, 200));
  return r.json();
}

/* Pass 2 discriminates the only two explanations for a wall:
 *   retention limit  -> every player's oldest message sits on roughly the SAME CALENDAR DATE
 *   personal history -> oldest dates are scattered, because each profile simply starts when it starts
 * One player can never tell these apart. Several can. */
async function pass2() {
  const now = Math.floor(Date.now() / 1000);
  log('\n══ Pass 2: is the wall a DATE (retention) or an AGE (that player\'s own history)? ══\n');
  for (const ws of ['lucky7even', 'fortuneplay', 'roosterbet']) {
    const key = resolveAppApiKey(ws);
    if (!key) continue;
    const wsFilter = ws === DEFAULT_WORKSPACE
      ? '&campaigns_v2.or=(cio_workspace.eq.lucky7even,cio_workspace.is.null)'
      : `&campaigns_v2.cio_workspace=eq.${ws}`;
    const rows = await sbGet(
      'campaign_numbers_v2?select=cio_id,campaigns_v2!inner(cio_workspace)' +
      '&cio_id=not.is.null&last_attempted_at=not.is.null&order=last_attempted_at.desc&limit=8' + wsFilter,
    );
    const dates = [];
    for (const row of rows) {
      let next = null, oldest = null, pages = 0, total = 0;
      do {
        const qs = `id_type=cio_id&limit=100&start_ts=${now - 1095 * 86400}&end_ts=${now}` +
                   (next ? `&start=${encodeURIComponent(next)}` : '');
        const r = await cio(key, `/v1/customers/${row.cio_id}/messages?${qs}`);
        if (r.status !== 200) break;
        const msgs = r.body.messages || [];
        total += msgs.length;
        for (const m of msgs) {
          const t = m.created ?? m.metrics?.sent;
          if (t && (oldest === null || t < oldest)) oldest = t;
        }
        next = r.body.next || null; pages++;
      } while (next && pages < 30);
      if (oldest) dates.push({ cio: String(row.cio_id).slice(0, 8), date: new Date(oldest * 1000).toISOString().slice(0, 10), n: total });
    }
    const uniq = [...new Set(dates.map((d) => d.date))].sort();
    log(`${ws}  ${dates.length} players sampled`);
    for (const d of dates) log(`    ${d.cio}…  oldest ${d.date}  (${d.n} msgs)`);
    // The verdict is about the SPAN, not the count of distinct dates. Counting distinct dates
    // called 8 players whose oldest messages all fell inside 9 days "scattered" on the first run,
    // which is the opposite of what the data said. A wall is narrow; real history is wide.
    const spanDays = uniq.length
      ? Math.round((Date.parse(uniq[uniq.length - 1]) - Date.parse(uniq[0])) / 86400000)
      : 0;
    const oldestAgeDays = uniq.length ? Math.round((Date.now() - Date.parse(uniq[0])) / 86400000) : 0;
    log(`    -> ${uniq.length} distinct oldest-dates spanning ${spanDays} days (${uniq[0]} .. ${uniq[uniq.length - 1]}), oldest ${oldestAgeDays} days back`);
    log(`    -> ${spanDays <= 14 ? 'CLUSTERED' : 'SCATTERED'}; ` +
        `${oldestAgeDays > 60 ? 'and history reaches well past 60 days, so this is NOT a 30-day retention wall' : 'nothing here reaches past 60 days'}\n`);
  }
}

(async () => {
  const now = Math.floor(Date.now() / 1000);
  const WINDOWS = [7, 30, 60, 90, 180, 365, 1095];
  log('Oldest message returned per lookback window, one contacted player per workspace.');
  log('A wall that stops moving = a retention limit. Numbers that keep growing = full history.\n');

  for (const ws of ['lucky7even', 'fortuneplay', 'roosterbet']) {
    const key = resolveAppApiKey(ws);
    if (!key) { log(`${ws}: no key`); continue; }
    const wsFilter = ws === DEFAULT_WORKSPACE
      ? '&campaigns_v2.or=(cio_workspace.eq.lucky7even,cio_workspace.is.null)'
      : `&campaigns_v2.cio_workspace=eq.${ws}`;
    const rows = await sbGet(
      'campaign_numbers_v2?select=cio_id,campaigns_v2!inner(cio_workspace)' +
      '&cio_id=not.is.null&last_attempted_at=not.is.null&order=last_attempted_at.desc&limit=1' + wsFilter,
    );
    if (!rows[0]) { log(`${ws}: no contacted player`); continue; }
    const cioId = rows[0].cio_id;
    log(`${ws}  (cio_id ${String(cioId).slice(0, 8)}…)`);

    for (const days of WINDOWS) {
      // Page fully: a count that stops growing because of the page cap is not a retention wall.
      let next = null, total = 0, oldest = null, pages = 0, status = 200;
      do {
        const qs = `id_type=cio_id&limit=100&start_ts=${now - days * 86400}&end_ts=${now}` +
                   (next ? `&start=${encodeURIComponent(next)}` : '');
        const r = await cio(key, `/v1/customers/${cioId}/messages?${qs}`);
        status = r.status;
        if (r.status !== 200) break;
        const msgs = r.body.messages || [];
        total += msgs.length;
        for (const m of msgs) {
          const t = m.created ?? m.metrics?.sent;
          if (t && (oldest === null || t < oldest)) oldest = t;
        }
        next = r.body.next || null;
        pages++;
      } while (next && pages < 30);
      const age = oldest ? ((now - oldest) / 86400).toFixed(1) : '—';
      log(`   ${String(days).padStart(4)}d window: ${status === 200 ? `${String(total).padStart(4)} msgs, oldest ${age} days old (${pages} page${pages === 1 ? '' : 's'})` : `HTTP ${status}`}`);
    }
    log('');
  }
  await pass2();
})().catch((e) => { log("FATAL " + e.message); process.exit(1); });
