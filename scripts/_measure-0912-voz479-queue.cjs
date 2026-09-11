/* _measure-0912-voz479-queue.cjs — READ-ONLY. How big is the VOZ-479 nightly queue, really?
 *
 * The design sized the job from numbers measured on 10 Sep. Before building to them, measure
 * again from our own tables: queue size, cio_id coverage, workspace split, and the phones that
 * carry more than one CRM account (the 08 Sep bug: a Map<phone, cio> silently drops the rest).
 *
 * Usage: node scripts/_measure-0912-voz479-queue.cjs [days]   (default 30)
 */
const fs = require('fs');
const log = (s) => process.stdout.write(s + '\n');
const env = {};
for (const l of fs.readFileSync('C:/Users/jasin/Desktop/voizo/Voizo/.env.local', 'utf8').split(/\r?\n/)) {
  const i = l.indexOf('=');
  if (i > 0 && !l.startsWith('#')) env[l.slice(0, i).trim()] = l.slice(i + 1).trim().replace(/^["']|["']$/g, '');
}
const h = { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: 'Bearer ' + env.SUPABASE_SERVICE_ROLE_KEY };
const DAYS = Number(process.argv[2] || 30);

/** PostgREST clamps EVERY read at 1,000 rows and ignores &limit. Page with Range and assert the
 *  total, or a silent truncation becomes a confident wrong number. */
async function pageAll(table, qs) {
  const out = []; const step = 1000;
  for (let from = 0; ; from += step) {
    const r = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/${table}?${qs}`, {
      headers: { ...h, Range: `${from}-${from + step - 1}`, 'Range-Unit': 'items', Prefer: 'count=exact' },
    });
    if (!r.ok) throw new Error(`${table} ${r.status} ${(await r.text()).slice(0, 300)}`);
    const chunk = await r.json();
    out.push(...chunk);
    const total = Number(String(r.headers.get('content-range') || '').split('/')[1]);
    if (chunk.length < step) {
      if (Number.isFinite(total) && out.length !== total) throw new Error(`PAGING INCOMPLETE ${table}: ${out.length}/${total}`);
      return out;
    }
  }
}

(async () => {
  const since = new Date(Date.now() - DAYS * 86400_000).toISOString();
  log(`Players Voizo ATTEMPTED since ${since.slice(0, 10)} (${DAYS} days)\n`);

  const rows = await pageAll(
    'campaign_numbers_v2',
    'select=cio_id,phone_e164,last_attempted_at,campaign_id,campaigns_v2!inner(cio_workspace)' +
    `&last_attempted_at=gte.${since}&order=last_attempted_at.desc`,
  );
  log(`  rows (campaign x phone):        ${rows.length}`);

  const ws = (r) => (r.campaigns_v2?.cio_workspace || 'lucky7even');
  const phones = new Set(rows.map((r) => r.phone_e164));
  const withId = rows.filter((r) => r.cio_id);
  const phonesWithId = new Set(withId.map((r) => r.phone_e164));
  log(`  distinct phones:                ${phones.size}`);
  log(`  rows carrying a cio_id:         ${withId.length} of ${rows.length} (${(100 * withId.length / rows.length).toFixed(1)}%)`);
  log(`  distinct phones with a cio_id:  ${phonesWithId.size} of ${phones.size} (${(100 * phonesWithId.size / phones.size).toFixed(1)}%)`);

  // THE QUEUE KEY. Never Map<phone, cio> — one phone carries several CRM accounts.
  const queue = new Set(withId.map((r) => `${ws(r)}|${r.cio_id}`));
  log(`\n  QUEUE = distinct (workspace, cio_id): ${queue.size}`);

  const byWs = {};
  for (const k of queue) { const w = k.split('|')[0]; byWs[w] = (byWs[w] || 0) + 1; }
  for (const [w, n] of Object.entries(byWs).sort((a, b) => b[1] - a[1])) log(`    ${w.padEnd(14)} ${n}`);

  // How much would a Map<phone, cio> have dropped?
  const cioByPhone = new Map();
  for (const r of withId) {
    if (!cioByPhone.has(r.phone_e164)) cioByPhone.set(r.phone_e164, new Set());
    cioByPhone.get(r.phone_e164).add(r.cio_id);
  }
  const multi = [...cioByPhone.values()].filter((s) => s.size > 1);
  const extra = multi.reduce((a, s) => a + s.size - 1, 0);
  log(`\n  phones carrying >1 cio_id:      ${multi.length}`);
  log(`  accounts a Map<phone,cio> drops: ${extra}  <-- the 08 Sep undercount bug`);

  // Per-day arrival, so the nightly budget is sized against the spike, not the median.
  const byDay = {};
  for (const r of withId) { const d = r.last_attempted_at.slice(0, 10); (byDay[d] ||= new Set()).add(`${ws(r)}|${r.cio_id}`); }
  const days = Object.entries(byDay).map(([d, s]) => [d, s.size]).sort((a, b) => a[0] < b[0] ? 1 : -1);
  const counts = days.map((d) => d[1]).sort((a, b) => a - b);
  const med = counts[Math.floor(counts.length / 2)];
  log(`\n  per-day NEW accounts contacted: median ${med}, min ${counts[0]}, max ${counts[counts.length - 1]}`);
  log('  last 10 days: ' + days.slice(0, 10).map(([d, n]) => `${d.slice(5)}=${n}`).join(' '));

  // ── Where do cio_ids actually live? campaign_numbers_v2.cio_id is only ~23% populated, so a
  // queue built from it alone would cover a third of contacted players and never say so.
  log('\n─── cio_id SOURCES for the same attempted phones ───');
  const spine = await pageAll(
    'realtime_seen_members',
    'select=cio_id,phone_e164,parent_campaign_id,campaigns_v2!realtime_seen_members_parent_campaign_id_fkey(cio_workspace)&cio_id=not.is.null',
  );
  log(`  realtime_seen_members rows with a cio_id: ${spine.length}`);

  const spineByPhone = new Map();
  for (const s of spine) {
    if (!spineByPhone.has(s.phone_e164)) spineByPhone.set(s.phone_e164, new Set());
    spineByPhone.get(s.phone_e164).add(`${s.campaigns_v2?.cio_workspace || 'lucky7even'}|${s.cio_id}`);
  }

  let fromNumbers = 0, fromSpine = 0, fromBoth = 0, fromNeither = 0;
  const union = new Set(queue);
  for (const p of phones) {
    const a = phonesWithId.has(p);
    const b = spineByPhone.has(p);
    if (a && b) fromBoth++; else if (a) fromNumbers++; else if (b) fromSpine++; else fromNeither++;
    if (b) for (const k of spineByPhone.get(p)) union.add(k);
  }
  log(`  phones resolved by campaign_numbers_v2 only: ${fromNumbers}`);
  log(`  phones resolved by realtime_seen_members only: ${fromSpine}   <-- lost if we use one source`);
  log(`  phones resolved by both:                     ${fromBoth}`);
  log(`  phones resolved by NEITHER:                  ${fromNeither} of ${phones.size} (${(100 * fromNeither / phones.size).toFixed(1)}%)`);
  log(`\n  QUEUE from both sources: ${union.size}  (was ${queue.size} from campaign_numbers_v2 alone)`);

  const byWsU = {};
  for (const k of union) { const w = k.split('|')[0]; byWsU[w] = (byWsU[w] || 0) + 1; }
  for (const [w, n] of Object.entries(byWsU).sort((a, b) => b[1] - a[1])) {
    log(`    ${w.padEnd(14)} ${String(n).padStart(5)}   (campaign_numbers_v2 alone: ${byWs[w] || 0})`);
  }

  // A cio_id is workspace-scoped: pairing one with the wrong workspace 404s (control C2). If the
  // same cio_id appears under two workspaces, some pairs are guaranteed to fail every night.
  const wsPerCio = new Map();
  for (const k of union) {
    const [w, c] = k.split('|');
    if (!wsPerCio.has(c)) wsPerCio.set(c, new Set());
    wsPerCio.get(c).add(w);
  }
  const ambiguous = [...wsPerCio.values()].filter((s) => s.size > 1).length;
  log(`\n  cio_ids claimed by >1 workspace: ${ambiguous} of ${wsPerCio.size}` +
      `  ${ambiguous ? '<-- these pairs will 404; expected, counted, not an outage' : '(clean)'}`);

  // Throughput: chunkedPromiseAll(…, 8, 150ms) is the prod-proven rate policy (3 callers).
  const perSec = 8 / 0.5; // 8 parallel ~350ms + 150ms pause
  const budget = 270;
  log(`\n  at the prod rate policy (8 per ~500ms = ~${perSec}/s), budget ${budget}s of maxDuration 300:`);
  log(`    one night drains:            ~${budget * perSec} accounts`);
  log(`    full queue of ${union.size}:       ~${Math.ceil(union.size / perSec)} s = ${(union.size / perSec / budget).toFixed(1)} nights to cycle`);
  log(`    steady state (median ${med}/day): ~${Math.ceil(med / perSec)} s`);
})().catch((e) => { log('FATAL ' + e.message); process.exit(1); });
