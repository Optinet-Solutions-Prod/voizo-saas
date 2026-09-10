/* _gate-0910-deposit-rollup.cjs — READ-ONLY. The money strip following the table's filters, proved.
 *
 * Drives the RUNNING app (localhost:3111) so the whole chain is exercised: scope resolution, the
 * family rule, search sanitising, the new function, the mapping.
 *
 *   1. KNOWN-GOOD. With every filter at "any", the new route's deposits must equal the OLD reach
 *      route's deposits (the two older functions) to the row: days, currencies, depositors. Three
 *      scopes, two windows. Any difference means the population rules diverged.
 *   2. FILTERED. Contact = spoke, 7d, all markets: the new route's currency totals and depositor
 *      count must equal a JS recount over the Depositors table's own rows (the players route with
 *      deposited=after & contact=spoke), summing each player's in-window after-contact deposits.
 *      This is exactly the check Jasiel did by hand with three currencies and Google.
 *   3. KNOWN-BAD. spoke and never_spoke must differ; a bogus contact value must fall back to "any"
 *      and equal the unfiltered strip; a bogus family must yield zero, never everyone.
 *   4. TIME. All brands, all markets, all time, unfiltered: under the 8-second statement limit.
 *
 * Before the SQL is applied, every part reports the route's `unavailable` reason and the gate fails.
 */
const fs = require('fs');
const log = (s) => process.stdout.write(s + '\n');
const envf = fs.readFileSync('C:/Users/jasin/Desktop/voizo/Voizo/.env.local', 'utf8');
const g = (k) => (envf.match(new RegExp('^' + k + '=(.*)$', 'm')) || [, ''])[1].trim().replace(/^["']|["']$/g, '');
const auth = 'Basic ' + Buffer.from(g('DASHBOARD_USERNAME') + ':' + g('DASHBOARD_PASSWORD')).toString('base64');
const get = async (p) => { const t0 = Date.now(); const r = await fetch('http://localhost:3111' + p, { headers: { Authorization: auth } }); if (!r.ok) throw new Error(p + ' HTTP ' + r.status); return { json: await r.json(), ms: Date.now() - t0 }; };
let failures = 0;
const check = (name, ok, detail) => { log((ok ? '  PASS  ' : '  FAIL  ') + name + (detail ? '   ' + detail : '')); if (!ok) failures++; };
const near = (a, b) => Math.abs(Number(a) - Number(b)) < 0.005;

function sameDeposits(a, b) {
  const diffs = [];
  if (!a || !b) return ['one side is null: new=' + !!a + ' old=' + !!b];
  if (a.depositors !== b.depositors) diffs.push('depositors ' + a.depositors + ' vs ' + b.depositors);
  const da = new Map(a.days.map((d) => [d.day, d])), db = new Map((b.days || []).map((d) => [d.day, d]));
  for (const k of new Set([...da.keys(), ...db.keys()])) {
    const x = da.get(k), y = db.get(k);
    if (!x || !y) { diffs.push('day ' + k + ' only on ' + (x ? 'new' : 'old')); continue; }
    if (x.deposits !== y.deposits || x.players !== y.players || x.depositsBefore !== y.depositsBefore || !near(x.amountEur, y.amountEur)) diffs.push('day ' + k + ' ' + JSON.stringify(x) + ' vs ' + JSON.stringify(y));
  }
  const ta = new Map((a.totals || []).map((t) => [t.currency, t])), tb = new Map((b.totals || []).map((t) => [t.currency, t]));
  for (const k of new Set([...ta.keys(), ...tb.keys()])) {
    const x = ta.get(k), y = tb.get(k);
    if (!x || !y) { diffs.push('currency ' + k + ' only on ' + (x ? 'new' : 'old')); continue; }
    if (x.deposits !== y.deposits || x.players !== y.players || x.before !== y.before || !near(x.amountLocal, y.amountLocal) || !near(x.amountEur, y.amountEur)) diffs.push('currency ' + k + ' ' + JSON.stringify(x) + ' vs ' + JSON.stringify(y));
  }
  return diffs;
}

(async () => {
  // self-test: the comparator must catch a one-cent difference and a missing day
  const base = { depositors: 1, days: [{ day: '2026-09-01', deposits: 1, players: 1, amountEur: 10, depositsBefore: 0 }], totals: [{ currency: 'AUD', deposits: 1, players: 1, amountLocal: 15, amountEur: 10, before: 0 }] };
  if (sameDeposits(base, base).length !== 0) throw new Error('SELF-TEST: identical must match');
  if (sameDeposits(base, { ...base, totals: [{ ...base.totals[0], amountEur: 10.01 }] }).length === 0) throw new Error('SELF-TEST: one cent must differ');
  if (sameDeposits(base, { ...base, days: [] }).length === 0) throw new Error('SELF-TEST: a missing day must differ');
  log('self-test OK\n');

  log('=== 1. KNOWN-GOOD: filters at any, against two references that do not use the new function ===');
  // The page's market token is the full NAME ("Australia"), not the ISO code: "AU" resolves to zero
  // campaigns, which the first run of this gate read as a null-vs-null comparison.
  //
  // Two references. (a) ALL TIME: the reach route still serves `deposited` from the two ORIGINAL
  // functions (per-currency totals + the depositor count), because the Reach card needs them; the
  // new route at range=lifetime must equal it to the row. (b) THE WINDOW: the reach route's window
  // deposits block was removed on 2026-09-10 (it duplicated this route's work and the page 500'd),
  // so the 7d reference is a recount over the Depositors table's own rows, the same technique as
  // part 2 and independent of every SQL function.
  const scopes = [['', ''], ['fortuneplay', 'Australia'], ['lucky7even', 'Australia']];
  let unavailable = null;
  for (const [brand, country] of scopes) {
    const scopeQs = (brand ? '&brand=' + brand : '') + (country ? '&country=' + encodeURIComponent(country) : '');
    const name = (brand || 'all brands') + ' ' + (country || 'all markets');
    // Sequential on purpose: fired together the statements contend and a timeout would mask the
    // comparison. Part 4 times the worst case on its own.
    const life = await get('/api/audience/deposits?range=lifetime' + scopeQs);
    if (!(life.json.scopeCampaigns > 0)) { check('scope resolves to campaigns (' + name + ')', false, 'new ' + life.json.scopeCampaigns); continue; }
    if (life.json.unavailable) {
      if (/Could not find the function/.test(life.json.unavailable)) unavailable = life.json.unavailable;
      check('new route available (' + name + ' lifetime)', false, life.json.unavailable + '   (' + life.ms + ' ms)');
      continue;
    }
    const old = await get('/api/audience/reach?range=lifetime' + scopeQs);
    const ref = old.json.deposited; // { players, totals } from the two ORIGINAL functions
    if (!ref) { check(name + ' lifetime: the old functions answered', false, 'reach.deposited is null: ' + JSON.stringify(old.json.unavailable)); }
    else {
      const d = life.json.deposits;
      const diffs = sameDeposits({ depositors: d.depositors, days: [], totals: d.totals }, { depositors: ref.players, days: [], totals: ref.totals });
      check(name + ' all time: ' + d.depositors + ' depositors, ' + d.totals.length + ' currencies == the original functions', diffs.length === 0, diffs.slice(0, 3).join(' | '));
    }
    // (b) the window, against the table's rows
    const win = await get('/api/audience/deposits?range=7d' + scopeQs);
    if (win.json.unavailable) { check('new route available (' + name + ' 7d)', false, win.json.unavailable); continue; }
    const rows = [];
    for (let p = 1; p < 60; p++) { const j = (await get('/api/audience/players?range=7d&deposited=after' + scopeQs + '&page=' + p)).json; rows.push(...j.rows); if (rows.length >= j.total || !j.rows.length) break; }
    const d = win.json.deposits;
    const inWin = (x) => x.afterContact && x.at >= d.from && x.at < d.to;
    let deps = 0, eur = 0; const ppl = new Set();
    for (const r of rows) for (const x of r.deposits.filter(inWin)) { deps++; eur += x.amountEur || 0; ppl.add(r.phone); }
    const stripDeps = d.totals.reduce((a, t) => a + t.deposits, 0), stripEur = d.totals.reduce((a, t) => a + t.amountEur, 0);
    check(name + ' 7d: ' + d.depositors + ' depositors / ' + stripDeps + ' deposits / EUR ' + stripEur.toFixed(2) + ' == the table\'s rows ' + ppl.size + ' / ' + deps + ' / ' + eur.toFixed(2),
      d.depositors === ppl.size && stripDeps === deps && near(stripEur, eur));
  }
  if (unavailable) { log('\nGATE FAILED — the function is not applied: ' + unavailable); process.exit(1); }

  log('\n=== 2. FILTERED: contact=spoke, 7d, all markets == a recount over the table\'s own rows ===');
  const filt = (await get('/api/audience/deposits?range=7d&contact=spoke')).json.deposits;
  const rows = [];
  for (let p = 1; p < 40; p++) { const j = (await get('/api/audience/players?range=7d&deposited=after&contact=spoke&page=' + p)).json; rows.push(...j.rows); if (rows.length >= j.total || !j.rows.length) break; }
  const inWin = (x) => x.afterContact && x.at >= filt.from && x.at < filt.to;
  const byCur = {}; let deps = 0; const players = new Set();
  for (const r of rows) for (const x of r.deposits.filter(inWin)) { deps++; players.add(r.phone); const c = byCur[x.currency] || (byCur[x.currency] = { deposits: 0, local: 0, eur: 0 }); c.deposits++; c.local += x.amountLocal || 0; c.eur += x.amountEur || 0; }
  check('depositors ' + filt.depositors + ' == distinct table rows with an in-window deposit ' + players.size, filt.depositors === players.size);
  check('deposits ' + filt.totals.reduce((a, t) => a + t.deposits, 0) + ' == ' + deps, filt.totals.reduce((a, t) => a + t.deposits, 0) === deps);
  for (const t of filt.totals) {
    const j = byCur[t.currency] || { deposits: 0, local: 0, eur: 0 };
    check(t.currency + ' local ' + t.amountLocal.toFixed(2) + ' / EUR ' + t.amountEur.toFixed(2) + ' == recount ' + j.local.toFixed(2) + ' / ' + j.eur.toFixed(2), near(t.amountLocal, j.local) && near(t.amountEur, j.eur) && t.deposits === j.deposits);
  }
  check('no currency in the recount is missing from the strip', Object.keys(byCur).every((c) => filt.totals.some((t) => t.currency === c)));

  log('\n=== 3. KNOWN-BAD ===');
  const any = (await get('/api/audience/deposits?range=7d')).json.deposits;
  const never = (await get('/api/audience/deposits?range=7d&contact=never_spoke')).json.deposits;
  check('spoke and never_spoke differ (' + filt.depositors + ' vs ' + never.depositors + ')', sameDeposits(filt, never).length > 0);
  check('spoke + never_spoke depositors == any (' + filt.depositors + ' + ' + never.depositors + ' = ' + any.depositors + ')', filt.depositors + never.depositors === any.depositors);
  const bogus = (await get('/api/audience/deposits?range=7d&contact=zzz')).json.deposits;
  check('a bogus contact value falls back to any', sameDeposits(bogus, any).length === 0);
  const noFam = (await get('/api/audience/deposits?range=7d&family=no-such-family-key')).json.deposits;
  check('a bogus family yields zero depositors, never everyone', noFam.depositors === 0 && (noFam.totals || []).length === 0);

  log('\n=== 4. TIME: all brands, all markets, all time, unfiltered ===');
  const t = await get('/api/audience/deposits?range=lifetime');
  check('under 8 s through the app', t.ms < 8000, t.ms + ' ms, ' + (t.json.deposits?.depositors ?? '?') + ' depositors all time');

  log('\n' + (failures === 0 ? 'GATE PASSED — every check green.' : 'GATE FAILED — ' + failures + ' check(s) red.'));
  process.exit(failures === 0 ? 0 : 1);
})();
