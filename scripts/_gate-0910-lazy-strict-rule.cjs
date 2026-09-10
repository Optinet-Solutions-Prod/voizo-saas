/* _gate-0910-lazy-strict-rule.cjs — READ-ONLY. The strict rule went lazy in audience_lane_players v5:
 * computed over the whole lane only for contact = spoke / never_spoke, and per player for the page's
 * rows otherwise. Answers must not change. This proves it three ways, through the running app.
 *
 *   1. LAZY == EAGER, every row. The membership of contact=spoke and contact=never_spoke (eager path)
 *      partitions the lane; every row on the first pages of contact=any (lazy path) must carry the
 *      spokeWith that membership says. Any disagreement means the two paths diverged.
 *   2. The counts you have seen all day still hold: spoke + never_spoke == contacted; the 7d spoke count.
 *   3. KNOWN-BAD: a row's spokeWith is a real boolean, never undefined, so the CSV column cannot read
 *      blank; and the strict count is strictly smaller than the lean "reached" count (it must be).
 *   4. TIME: players at contact=any, all brands, 7d, five runs, each under the 8 s limit with headroom.
 */
const fs = require('fs');
const log = (s) => process.stdout.write(s + '\n');
const envf = fs.readFileSync('C:/Users/jasin/Desktop/voizo/Voizo/.env.local', 'utf8');
const g = (k) => (envf.match(new RegExp('^' + k + '=(.*)$', 'm')) || [, ''])[1].trim().replace(/^["']|["']$/g, '');
const auth = 'Basic ' + Buffer.from(g('DASHBOARD_USERNAME') + ':' + g('DASHBOARD_PASSWORD')).toString('base64');
const get = async (p) => { const t0 = Date.now(); const r = await fetch('http://localhost:3111' + p, { headers: { Authorization: auth } }); if (!r.ok) throw new Error(p + ' HTTP ' + r.status); return { json: await r.json(), ms: Date.now() - t0 }; };
const pages = async (qs, max = 40) => { const out = []; let total = 0; for (let p = 1; p <= max; p++) { const j = (await get('/api/audience/players?' + qs + '&page=' + p)).json; total = j.total; out.push(...j.rows); if (out.length >= total || !j.rows.length) break; } return { rows: out, total }; };
let failures = 0;
const check = (name, ok, detail) => { log((ok ? '  PASS  ' : '  FAIL  ') + name + (detail ? '   ' + detail : '')); if (!ok) failures++; };

(async () => {
  log('=== 1. LAZY == EAGER, row by row (7d, all brands, all markets) ===');
  const spoke = await pages('range=7d&contact=spoke');
  const never = await pages('range=7d&contact=never_spoke');
  const S = new Set(spoke.rows.map((r) => r.phone)), N = new Set(never.rows.map((r) => r.phone));
  check('eager sets are disjoint', [...S].every((p) => !N.has(p)));
  const any = await pages('range=7d', 8); // the first 200 rows on the lazy path
  let mismatch = 0, undefinedCount = 0; const ex = [];
  for (const r of any.rows) {
    if (typeof r.spokeWith !== 'boolean') { undefinedCount++; continue; }
    const eager = S.has(r.phone) ? true : N.has(r.phone) ? false : null;
    if (eager === null) continue; // not in either eager set: the lazy row is outside the 7d last-contact window? cannot happen for the same window, counted below
    if (eager !== r.spokeWith) { mismatch++; if (ex.length < 5) ex.push(r.phone.slice(0, 7) + '*** lazy=' + r.spokeWith + ' eager=' + eager); }
  }
  const covered = any.rows.filter((r) => S.has(r.phone) || N.has(r.phone)).length;
  check('every lazy row is in exactly one eager set', covered === any.rows.length, covered + ' of ' + any.rows.length);
  check('lazy verdict == eager verdict on ' + any.rows.length + ' rows', mismatch === 0, mismatch ? mismatch + ' mismatches: ' + ex.join(' | ') : 'exact');

  log('\n=== 2. the day\'s numbers still hold ===');
  const contacted = any.total;
  check('spoke ' + spoke.total + ' + never_spoke ' + never.total + ' == contacted ' + contacted, spoke.total + never.total === contacted);
  const reached = (await get('/api/audience/players?range=7d&contact=reached&page=1')).json.total;
  check('strict (' + spoke.total + ') is strictly smaller than lean reached (' + reached + ')', spoke.total < reached);

  log('\n=== 3. KNOWN-BAD ===');
  check('no row carries an undefined spokeWith (the CSV column would read blank)', undefinedCount === 0, undefinedCount + ' undefined');
  const t0 = Date.now();
  const csvRes = await fetch('http://localhost:3111/api/audience/players?range=7d&format=csv', { headers: { Authorization: auth } });
  const csv = await csvRes.text();
  // The export pages the function at 1,000 rows: the lazy path's worst case. v5 timed out here.
  check('the CSV export answers 200 under 8 s', csvRes.ok && Date.now() - t0 < 8000, 'HTTP ' + csvRes.status + ' in ' + (Date.now() - t0) + ' ms' + (csvRes.ok ? '' : ': ' + csv.slice(0, 80)));
  const lines = csv.replace(/^\uFEFF/, '').split('\r\n').filter(Boolean);
  const head = lines[0].split(',').map((s) => s.replace(/"/g, ''));
  const col = head.indexOf('spoke_with');
  const vals = new Set(lines.slice(1).map((l) => l.split(',')[col]));
  check('CSV spoke_with column holds only yes/no, never blank', col >= 0 && [...vals].every((v) => v === '"yes"' || v === '"no"'), [...vals].join(' '));
  const yes = lines.slice(1).filter((l) => l.split(',')[col] === '"yes"').length;
  check('CSV yes count == eager spoke count (' + spoke.total + ')', yes === spoke.total, yes + ' yes rows');

  log('\n=== 4. TIME: players, contact=any, all brands, 7d, five runs ===');
  const ts = [];
  for (let i = 0; i < 5; i++) { ts.push((await get('/api/audience/players?range=7d&page=1')).ms); await new Promise((r) => setTimeout(r, 1500)); }
  check('every run under 6 s through the app (2 s of headroom to the limit)', ts.every((t) => t < 6000), ts.map((t) => t + 'ms').join(' '));

  log('\n' + (failures === 0 ? 'GATE PASSED — every check green.' : 'GATE FAILED — ' + failures + ' check(s) red.'));
  process.exit(failures === 0 ? 0 : 1);
})();
