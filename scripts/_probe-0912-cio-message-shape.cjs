/* _probe-0912-cio-message-shape.cjs — READ-ONLY. What does a /messages row ACTUALLY look like?
 *
 * The VOZ-479 tests have to encode the real shape, not the design's description of it. This
 * reports the union of top-level keys, the union of `metrics` keys, the observed `type` values,
 * and the VALUE TYPE of every field — because a timestamp arriving as a string, or as
 * milliseconds instead of seconds, is the kind of thing that silently writes a row dated 57000 AD.
 *
 * PRIVACY: prints key names and value TYPES only. The one exception is a short allowlist of
 * fields known to be safe and needed for the mapping (type, campaign ids, state-ish scalars).
 * `recipient` and `customer_identifiers` are never printed, only counted — they are exactly what
 * must never reach our database.
 *
 * Usage: node scripts/_probe-0912-cio-message-shape.cjs
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
const SAFE_TO_PRINT = new Set(['type', 'campaign_id', 'broadcast_id', 'newsletter_id', 'msg_template_id', 'action_id', 'content_id', 'parent_action_id', 'deduplicate_id', 'trigger_id', 'transactional_message_id']);

function resolveAppApiKey(ws) {
  let map = {};
  try { map = JSON.parse(env.CUSTOMERIO_APP_API_KEYS || '{}'); } catch { map = {}; }
  if (typeof map[ws] === 'string' && map[ws].trim()) return map[ws].trim();
  if (ws === DEFAULT_WORKSPACE && env.CUSTOMERIO_APP_API_KEY) return env.CUSTOMERIO_APP_API_KEY;
  return null;
}
const cio = async (key, path) => {
  const r = await fetch(API + path, { headers: { Authorization: 'Bearer ' + key } });
  const t = await r.text();
  try { return { status: r.status, body: JSON.parse(t) }; } catch { return { status: r.status, body: t.slice(0, 200) }; }
};
const sbGet = async (p) => {
  const r = await fetch(env.NEXT_PUBLIC_SUPABASE_URL + '/rest/v1/' + p, { headers: h });
  if (!r.ok) throw new Error(p.slice(0, 60) + ' -> ' + r.status);
  return r.json();
};

const kind = (v) => v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v;

(async () => {
  const now = Math.floor(Date.now() / 1000);
  const topKeys = new Map();        // key -> Set of value types
  const metricKeys = new Map();     // metric -> {n, min, max}
  const types = new Map();
  const samples = [];
  let total = 0, withRecipient = 0, withIdentifiers = 0, forgotten = 0, noId = 0, noSent = 0;

  for (const ws of ['lucky7even', 'fortuneplay', 'roosterbet']) {
    const key = resolveAppApiKey(ws);
    if (!key) continue;
    const wsFilter = ws === DEFAULT_WORKSPACE
      ? '&campaigns_v2.or=(cio_workspace.eq.lucky7even,cio_workspace.is.null)'
      : `&campaigns_v2.cio_workspace=eq.${ws}`;
    const rows = await sbGet('campaign_numbers_v2?select=cio_id,campaigns_v2!inner(cio_workspace)' +
      '&cio_id=not.is.null&last_attempted_at=not.is.null&order=last_attempted_at.desc&limit=4' + wsFilter);
    for (const row of rows) {
      const r = await cio(key, `/v1/customers/${row.cio_id}/messages?id_type=cio_id&limit=100&start_ts=${now - 90 * 86400}&end_ts=${now}`);
      if (r.status !== 200) continue;
      for (const m of r.body.messages || []) {
        total++;
        if ('recipient' in m) withRecipient++;
        if ('customer_identifiers' in m) withIdentifiers++;
        if (m.forgotten === true) forgotten++;
        if (!m.id) noId++;
        if (!m.metrics || m.metrics.sent === undefined) noSent++;
        for (const [k, v] of Object.entries(m)) {
          if (!topKeys.has(k)) topKeys.set(k, new Set());
          topKeys.get(k).add(kind(v));
        }
        types.set(m.type, (types.get(m.type) || 0) + 1);
        for (const [k, v] of Object.entries(m.metrics || {})) {
          const e = metricKeys.get(k) || { n: 0, min: Infinity, max: -Infinity, kinds: new Set() };
          e.n++; e.kinds.add(kind(v));
          const num = Number(v);
          if (Number.isFinite(num)) { e.min = Math.min(e.min, num); e.max = Math.max(e.max, num); }
          metricKeys.set(k, e);
        }
        if (samples.length < 2) {
          const safe = {};
          for (const [k, v] of Object.entries(m)) safe[k] = SAFE_TO_PRINT.has(k) ? v : `<${kind(v)}>`;
          safe.metrics = m.metrics;
          samples.push(safe);
        }
      }
    }
  }

  log(`Messages inspected: ${total}\n`);
  log('── top-level keys (name : observed value types) ──');
  for (const [k, s] of [...topKeys].sort()) log(`  ${k.padEnd(26)} ${[...s].join(' | ')}`);
  log(`\n  carrying \`recipient\`:            ${withRecipient} of ${total}   <-- must never be stored`);
  log(`  carrying \`customer_identifiers\`: ${withIdentifiers} of ${total}   <-- must never be stored`);
  log(`  forgotten === true:              ${forgotten} of ${total}   <-- GDPR erasure; must not be stored`);
  log(`  missing \`id\` (cannot be keyed):  ${noId} of ${total}`);
  log(`  no \`metrics.sent\` at all:        ${noSent} of ${total}   <-- sent_at must stay NULL for these`);

  log('\n── metrics keys (the epoch map; D2 says there is no `state` field) ──');
  for (const [k, e] of [...metricKeys].sort()) {
    const digits = Number.isFinite(e.max) ? String(Math.trunc(e.max)).length : 0;
    log(`  ${k.padEnd(18)} n=${String(e.n).padStart(4)}  types=${[...e.kinds].join('|')}  ` +
        `range ${e.min}..${e.max}  (${digits} digits = ${digits >= 13 ? 'MILLISECONDS!' : 'seconds'})`);
  }

  log('\n── `type` values seen ──');
  for (const [t, n] of [...types].sort((a, b) => b[1] - a[1])) log(`  ${String(t).padEnd(16)} ${n}`);

  log('\n── two redacted samples (non-allowlisted values shown as <type>) ──');
  for (const s of samples) log('  ' + JSON.stringify(s));
})().catch((e) => { log('FATAL ' + e.message); process.exit(1); });
