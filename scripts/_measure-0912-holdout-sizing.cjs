/* _measure-0912-holdout-sizing.cjs — READ-ONLY. What could a holdout actually detect, and where?
 *
 * The arms script (_measure-0910-holdout-arms.cjs) compares a holdout that is running. This one
 * answers the question BEFORE it runs: pick which campaign, pick which share, and know in advance
 * what that buys. Writes nothing, flips nothing.
 *
 * Same conventions as the arms script on purpose, so the two cannot disagree:
 *   - the split key is parent_campaign_id || id, the key the coin actually uses
 *   - phone -> cio_id[] via realtime_seen_members, NEVER a Map of one (836 phones carry several)
 *   - a player counts as converted if a deposit_made lands within CONV_DAYS of them becoming a
 *     CANDIDATE (campaign_numbers_v2.created_at) — not after the call, because only the treated
 *     arm has a call and using it is the flaw that sank the observational comparison
 *
 * Usage: node scripts/_measure-0912-holdout-sizing.cjs [windowDays=30] [convDays=7]
 */
const fs = require('fs');
const log = (s) => process.stdout.write(s + '\n');
const env = {};
for (const l of fs.readFileSync('C:/Users/jasin/Desktop/voizo/Voizo/.env.local', 'utf8').split(/\r?\n/)) {
  const i = l.indexOf('=');
  if (i > 0 && !l.startsWith('#')) env[l.slice(0, i).trim()] = l.slice(i + 1).trim().replace(/^["']|["']$/g, '');
}
const h = { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: 'Bearer ' + env.SUPABASE_SERVICE_ROLE_KEY };
const WINDOW_DAYS = Number(process.argv[2] || 30);
const CONV_DAYS = Number(process.argv[3] || 7);

async function pageAll(table, qs) {
  const out = []; const step = 1000;
  for (let f = 0; ; f += step) {
    const r = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/${table}?${qs}`, {
      headers: { ...h, Range: `${f}-${f + step - 1}`, 'Range-Unit': 'items', Prefer: 'count=exact' },
    });
    if (!r.ok) throw new Error(`${table} ${r.status} ${(await r.text()).slice(0, 200)}`);
    const c = await r.json(); out.push(...c);
    const tot = Number(String(r.headers.get('content-range') || '').split('/')[1]);
    if (c.length < step) {
      if (Number.isFinite(tot) && out.length !== tot) throw new Error(`PAGING INCOMPLETE ${table}: ${out.length}/${tot}`);
      return out;
    }
  }
}

// ── statistics ────────────────────────────────────────────────────────────────────────────────
/** Normal CDF (Abramowitz & Stegun 7.1.26 via erf). */
function phi(z) {
  const t = 1 / (1 + 0.3275911 * Math.abs(z) / Math.SQRT2);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t
    * Math.exp(-(z / Math.SQRT2) * (z / Math.SQRT2));
  return z >= 0 ? 0.5 * (1 + y) : 0.5 * (1 - y);
}
const Z_ALPHA = 1.959963985; // two-sided 5%

/** Power of a two-proportion z-test. p1 = control rate, p2 = treated rate. */
function power(p1, p2, n1, n2) {
  if (n1 < 1 || n2 < 1 || p1 === p2) return 0;
  const pooled = (p1 * n1 + p2 * n2) / (n1 + n2);
  const se0 = Math.sqrt(pooled * (1 - pooled) * (1 / n1 + 1 / n2));
  const se1 = Math.sqrt((p1 * (1 - p1)) / n1 + (p2 * (1 - p2)) / n2);
  if (se1 === 0) return 0;
  return phi((Math.abs(p2 - p1) - Z_ALPHA * se0) / se1);
}

/** Smallest RELATIVE lift on the treated arm detectable at 80% power, or null past +400%. */
function mde(p1, nControl, nTreated) {
  for (let lift = 1.01; lift <= 5.0; lift += 0.01) {
    const p2 = Math.min(0.999, p1 * lift);
    if (power(p1, p2, nControl, nTreated) >= 0.8) return lift;
  }
  return null;
}

(async () => {
  // ── self-test: an instrument with no known-bad control proves nothing ──
  // Textbook two-proportion case: p1=.05, p2=.10, n=435/arm is the classic ~80% power point.
  const pw = power(0.05, 0.10, 435, 435);
  if (!(pw > 0.75 && pw < 0.85)) throw new Error(`SELF-TEST: power(.05,.10,435,435) = ${pw.toFixed(3)}, expected ~0.80`);
  // No effect must not look detectable.
  if (power(0.05, 0.05, 100000, 100000) > 0.06) throw new Error('SELF-TEST: a zero effect reads as detectable');
  // A tiny arm must not detect a small lift.
  if (power(0.02, 0.022, 50, 50) > 0.2) throw new Error('SELF-TEST: 50 per arm cannot detect a 10% lift');
  if (phi(0) < 0.499 || phi(0) > 0.501) throw new Error('SELF-TEST: phi(0) must be 0.5');
  log('self-test OK (power, phi, and two known-bad controls)\n');

  const since = new Date(Date.now() - WINDOW_DAYS * 86400_000).toISOString();
  const camps = await pageAll('campaigns_v2', 'select=id,name,status,cio_workspace,parent_campaign_id,is_test,source,holdout_pct');
  const byId = new Map(camps.map((c) => [c.id, c]));
  const live = camps.filter((c) => c.source !== 'ghost_portal' && c.is_test !== true);
  const liveIds = new Set(live.map((c) => c.id));
  const anyOn = camps.filter((c) => Number(c.holdout_pct || 0) > 0);
  log(`campaigns with holdout_pct > 0: ${anyOn.length}  ${anyOn.length ? '*** A HOLDOUT IS LIVE ***' : '(all inert, as expected)'}`);

  const nums = await pageAll('campaign_numbers_v2', `select=id,campaign_id,phone_e164,created_at&created_at=gte.${since}`);
  const seen = await pageAll('realtime_seen_members', 'select=phone_e164,cio_id&cio_id=not.is.null');
  const cioByPhone = new Map();
  for (const s of seen) {
    if (!cioByPhone.has(s.phone_e164)) cioByPhone.set(s.phone_e164, new Set());
    cioByPhone.get(s.phone_e164).add(s.cio_id);
  }
  const deposits = await pageAll('cio_events', 'select=cio_id,occurred_at&event_name=eq.deposit_made');
  const depByCio = new Map();
  for (const d of deposits) {
    if (!depByCio.has(d.cio_id)) depByCio.set(d.cio_id, []);
    depByCio.get(d.cio_id).push(Date.parse(d.occurred_at));
  }

  const familyKey = (id) => { const c = byId.get(id); return c ? (c.parent_campaign_id || c.id) : null; };
  const fam = new Map();
  let converted = 0;
  for (const n of nums) {
    if (!liveIds.has(n.campaign_id)) continue;
    const k = familyKey(n.campaign_id);
    if (!k) continue;
    if (!fam.has(k)) fam.set(k, { players: new Set(), deposited: new Set(), brand: byId.get(k)?.cio_workspace || 'lucky7even', name: byId.get(k)?.name || byId.get(n.campaign_id)?.name || k });
    const f = fam.get(k);
    f.players.add(n.phone_e164);
    const t0 = Date.parse(n.created_at);
    const cios = cioByPhone.get(n.phone_e164);
    if (!cios) continue;
    for (const cio of cios) {
      const hits = depByCio.get(cio) || [];
      if (hits.some((t) => t >= t0 && t <= t0 + CONV_DAYS * 86400_000)) { f.deposited.add(n.phone_e164); converted++; break; }
    }
  }

  const rows = [...fam.entries()]
    .map(([k, f]) => ({ k, name: f.name, brand: f.brand, n: f.players.size, dep: f.deposited.size }))
    .filter((r) => r.n > 0)
    .sort((a, b) => b.n - a.n);
  const totalN = rows.reduce((a, r) => a + r.n, 0);
  const totalDep = rows.reduce((a, r) => a + r.dep, 0);
  const baseRate = totalN ? totalDep / totalN : 0;

  log(`\nCandidates in the last ${WINDOW_DAYS} days: ${totalN} players across ${rows.length} families`);
  log(`Deposited within ${CONV_DAYS} days of becoming a candidate: ${totalDep}  = ${(100 * baseRate).toFixed(2)}% base rate\n`);

  // RANK BY EXPECTED DEPOSITS, NOT PLAYERS. Power comes from events. The first version of this
  // script ranked by volume and put a family with 512 players a week and a 0.00% deposit rate at
  // the top — you cannot measure a lift against a base of zero, however many calls you withhold.
  // It also priced that family using the GLOBAL 0.58% rate, which made an unmeasurable campaign
  // look like the obvious choice.
  const perWk = (n) => n / (WINDOW_DAYS / 7);
  const ranked = rows
    .map((r) => ({ ...r, rate: r.n ? r.dep / r.n : 0, playersWk: perWk(r.n), depWk: perWk(r.dep) }))
    .sort((x, y) => y.depWk - x.depWk);

  log('FAMILIES RANKED BY EXPECTED DEPOSITS PER WEEK (what the test actually runs on)');
  log('  dep/wk   players/wk    rate    family');
  for (const r of ranked.slice(0, 8)) {
    log(`  ${r.depWk.toFixed(1).padStart(6)}   ${r.playersWk.toFixed(0).padStart(10)}   ${(100 * r.rate).toFixed(2).padStart(5)}%   ${r.brand.padEnd(12)} ${String(r.name).slice(0, 44)}`);
  }

  const table = (label, playersWk, rate) => {
    log(`\n${label}`);
    log(`  ${playersWk.toFixed(0)} players a week · deposit rate ${(100 * rate).toFixed(2)}% · ${(playersWk * rate).toFixed(1)} deposits a week`);
    if (rate <= 0) { log('  base rate is ZERO — nothing to measure a lift against. Not a candidate.'); return; }
    log('  share   held/wk   ctrl dep/wk        4 weeks        8 weeks       13 weeks       26 weeks');
    log('  ' + '-'.repeat(92));
    for (const share of [0.10, 0.20, 0.30, 0.50]) {
      const cWk = playersWk * share, tWk = playersWk * (1 - share);
      const cells = [4, 8, 13, 26].map((wk) => {
        const m = mde(rate, cWk * wk, tWk * wk);
        return (m === null ? 'not detectable' : `+${((m - 1) * 100).toFixed(0)}%`).padStart(14);
      });
      log(`  ${String(Math.round(share * 100)).padStart(4)}%  ${cWk.toFixed(0).padStart(8)}   ${(cWk * rate).toFixed(1).padStart(11)}  ${cells.join(' ')}`);
    }
  };

  const bestFam = ranked[0];
  table(`OPTION 1 — the single best family: ${bestFam.name} (${bestFam.brand})`, bestFam.playersWk, bestFam.rate);
  table('OPTION 2 — ALL campaigns pooled, one share applied everywhere', perWk(totalN), baseRate);
  log('\n  "+X% lift" = the SMALLEST relative increase in deposits the test could distinguish from');
  log('  noise at 80% power, 5% two-sided. Anything smaller than that is invisible to this design,');
  log('  however long it runs. A holdout also COSTS the withheld players their calls.');
})().catch((e) => { log('FATAL ' + e.message); process.exit(1); });
