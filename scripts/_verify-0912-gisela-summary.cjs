/* _verify-0912-gisela-summary.cjs — READ-ONLY. Check Gisela's 12 Sep email against our own data.
 *
 * Standing rule (Jasiel 08-09): verify CRM claims ourselves, from our routes and our tables,
 * then discuss the effect and hand over the exact fix. Never edit their workspace.
 *
 * Her call block matches us EXACTLY on three numbers — 6,266 attempts, 3,289 voicemail, 41
 * positive — so we are looking at the same window and the same calls. Two numbers diverge:
 *   Silent Pickup        she says   977 (15.6%)   our dashboard says 0, and 0 over 90 days
 *   Established convos   she says   208 ( 3.3%)   our dashboard says 406 (6.5%)
 * This finds what definition produces 977 and 208, so the disagreement can be named instead of
 * argued about.
 *
 * Usage: node scripts/_verify-0912-gisela-summary.cjs
 */
const fs = require('fs');
const log = (s) => process.stdout.write(s + '\n');
const env = {};
for (const l of fs.readFileSync('C:/Users/jasin/Desktop/voizo/Voizo/.env.local', 'utf8').split(/\r?\n/)) {
  const i = l.indexOf('=');
  if (i > 0 && !l.startsWith('#')) env[l.slice(0, i).trim()] = l.slice(i + 1).trim().replace(/^["']|["']$/g, '');
}
const h = { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: 'Bearer ' + env.SUPABASE_SERVICE_ROLE_KEY };
const FROM = '2026-09-04T00:00:00Z';
const TO = '2026-09-12T00:00:00Z'; // the route reported rangeDays=8 and trend 09-04..09-11

async function pageAll(table, qs) {
  const out = []; const step = 1000;
  for (let from = 0; ; from += step) {
    const r = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/${table}?${qs}`, {
      headers: { ...h, Range: `${from}-${from + step - 1}`, 'Range-Unit': 'items', Prefer: 'count=exact' },
    });
    if (!r.ok) throw new Error(`${table} ${r.status} ${(await r.text()).slice(0, 200)}`);
    const chunk = await r.json();
    out.push(...chunk);
    const total = Number(String(r.headers.get('content-range') || '').split('/')[1]);
    if (chunk.length < step) {
      if (Number.isFinite(total) && out.length !== total) throw new Error(`PAGING INCOMPLETE ${table}: ${out.length}/${total}`);
      return out;
    }
  }
}

const tally = (rows, fn) => {
  const m = new Map();
  for (const r of rows) { const k = fn(r); m.set(k, (m.get(k) || 0) + 1); }
  return [...m].sort((a, b) => b[1] - a[1]);
};

(async () => {
  const calls = await pageAll('calls_v2',
    `select=id,status,ended_reason,hangup_cause,voicemail,duration_seconds,answered_at,goal_reached,campaign_id` +
    `&created_at=gte.${FROM}&created_at=lt.${TO}`);
  log(`calls_v2 rows in ${FROM.slice(0, 10)} .. ${TO.slice(0, 10)}: ${calls.length}`);
  log(`  the dashboard says 6,266 for the same window — ${calls.length === 6266 ? 'SAME POPULATION' : 'DIFFERENT, stop and reconcile first'}\n`);

  log('── ended_reason, the Vapi vocabulary (what a CRM-side report would most likely group on) ──');
  for (const [k, n] of tally(calls, (r) => String(r.ended_reason ?? 'null'))) {
    log(`  ${String(n).padStart(5)}  ${(100 * n / calls.length).toFixed(1).padStart(5)}%  ${k}`);
  }

  log('\n── our own flags ──');
  const vm = calls.filter((c) => c.voicemail === true).length;
  const answered = calls.filter((c) => c.answered_at !== null).length;
  log(`  voicemail = true            ${vm}   (Gisela: 3,289 · dashboard: 3,289)`);
  log(`  answered_at is not null     ${answered}`);
  log(`  goal_reached = true         ${calls.filter((c) => c.goal_reached === true).length}`);

  log('\n── talk time on ANSWERED calls, the shape that separates a real conversation from dead air ──');
  const ans = calls.filter((c) => c.answered_at !== null);
  const buckets = [[0, 0], [1, 5], [6, 10], [11, 20], [21, 30], [31, 60], [61, 120], [121, 1e9]];
  for (const [lo, hi] of buckets) {
    const n = ans.filter((c) => (c.duration_seconds ?? 0) >= lo && (c.duration_seconds ?? 0) <= hi).length;
    log(`  ${String(lo).padStart(4)}-${String(hi === 1e9 ? '∞' : hi).padEnd(4)}s  ${String(n).padStart(5)}`);
  }

  log('\n── hunting 977 and 208 ──');
  const notVm = ans.filter((c) => c.voicemail !== true);
  log(`  answered, not voicemail: ${notVm.length}`);
  for (const cut of [5, 10, 15, 20, 25, 30, 40, 45, 60]) {
    const under = notVm.filter((c) => (c.duration_seconds ?? 0) < cut).length;
    const over = notVm.filter((c) => (c.duration_seconds ?? 0) >= cut).length;
    log(`    duration < ${String(cut).padStart(2)}s: ${String(under).padStart(5)}   >= ${String(cut).padStart(2)}s: ${String(over).padStart(5)}` +
        `${under === 977 || over === 977 ? '   <-- 977, Gisela\'s Silent Pickup' : ''}` +
        `${under === 208 || over === 208 ? '   <-- 208, Gisela\'s Established' : ''}`);
  }
})().catch((e) => { log('FATAL ' + e.message); process.exit(1); });
