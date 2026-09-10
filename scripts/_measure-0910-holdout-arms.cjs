/* _measure-0910-holdout-arms.cjs — READ-ONLY. The deposit holdout's two arms, side by side.
 *
 * Deliberately a SCRIPT and not a card. The whole reason the holdout exists is that two
 * observational cards were built and rejected in one day, because a card invites a reader to
 * take a six-deposit difference as a finding. This prints arm SIZES first, confidence intervals
 * always, and refuses to name a winner until the arms are big enough to support one.
 *
 * Both arms are measured identically: deposits in the 7 days after the moment the player became
 * a CANDIDATE (campaign_numbers_v2.created_at), not after the call — only the treated arm has a
 * call, and using it was the flaw that sank the observational comparison.
 *
 * Usage:  node scripts/_measure-0910-holdout-arms.cjs [parentCampaignId] [windowDays]
 *         node scripts/_measure-0910-holdout-arms.cjs --all
 */
const fs = require('fs');
const { createHash } = require('node:crypto');
const log = (s) => process.stdout.write(s + '\n');
const env = {};
for (const l of fs.readFileSync('C:/Users/jasin/Desktop/voizo/Voizo/.env.local', 'utf8').split(/\r?\n/)) {
  const i = l.indexOf('=');
  if (i > 0 && !l.startsWith('#')) env[l.slice(0, i).trim()] = l.slice(i + 1).trim().replace(/^["']|["']$/g, '');
}
const h = { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: 'Bearer ' + env.SUPABASE_SERVICE_ROLE_KEY };

const isHeldOut = (playerKey, campaignKey, pct) => {
  const share = Math.floor(Number(pct));
  if (!Number.isFinite(share) || share <= 0) return false;
  if (share >= 100) return true;
  return createHash('sha1').update(`${playerKey}|${campaignKey}`).digest().readUInt32BE(0) % 100 < share;
};

async function pageAll(table, select, extra) {
  const out = []; const step = 1000;
  for (let from = 0; ; from += step) {
    const r = await fetch(env.NEXT_PUBLIC_SUPABASE_URL + '/rest/v1/' + table + '?select=' + select + (extra || ''), {
      headers: { ...h, Range: from + '-' + (from + step - 1), 'Range-Unit': 'items', Prefer: 'count=exact' },
    });
    if (!r.ok) throw new Error(table + ' ' + r.status + ' ' + (await r.text()).slice(0, 200));
    const chunk = await r.json(); out.push(...chunk);
    const total = Number(String(r.headers.get('content-range') || '').split('/')[1]);
    if (chunk.length < step) {
      if (Number.isFinite(total) && out.length !== total) throw new Error('PAGING INCOMPLETE ' + table + ': ' + out.length + '/' + total);
      return out;
    }
  }
}

/** Wilson score interval — correct at the tiny proportions this measures, where the
 *  textbook normal interval goes negative and reads as certainty. */
function wilson(successes, n, z = 1.96) {
  if (n === 0) return [0, 0];
  const p = successes / n, d = 1 + (z * z) / n;
  const centre = (p + (z * z) / (2 * n)) / d;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return [Math.max(0, centre - half), Math.min(1, centre + half)];
}
const pctS = (x) => (x * 100).toFixed(2) + '%';

(async () => {
  // ── self-test with known-bad inputs ──
  const [lo, hi] = wilson(1, 1000);
  if (!(lo > 0 && lo < 0.001 && hi > 0.001 && hi < 0.02)) throw new Error('SELF-TEST: wilson 1/1000 ' + lo + ' ' + hi);
  if (wilson(0, 0)[1] !== 0) throw new Error('SELF-TEST: wilson empty arm');
  if (wilson(0, 500)[0] !== 0) throw new Error('SELF-TEST: zero successes must have a floor of 0');
  // Wilson's upper bound at p=1 converges on 1 rather than landing exactly on it, and in
  // floating point it arrives a hair under. Assert the behaviour, not the literal.
  if (wilson(500, 500)[1] < 0.999) throw new Error('SELF-TEST: all successes must approach 1');
  if (wilson(500, 500)[0] > 0.995) throw new Error('SELF-TEST: even 500/500 keeps a lower bound below 1');
  // known-bad control: the naive normal interval would go NEGATIVE here, which is why it is not used
  const naiveLo = 1 / 1000 - 1.96 * Math.sqrt((0.001 * 0.999) / 1000);
  if (naiveLo >= 0) throw new Error('SELF-TEST: the control interval was supposed to be negative');
  log('self-test OK\n');

  const argv = process.argv.slice(2);
  const windowDays = Number(argv.find((a) => /^\d+$/.test(a)) || 7);
  const wantAll = argv.includes('--all');
  const wantParent = argv.find((a) => /^[0-9a-f-]{36}$/i.test(a));

  // select=* for the same reason the dialer does it: naming holdout_pct before the migration
  // is applied fails the whole query, and this script must still run (and say so) either way.
  const camps = await pageAll('campaigns_v2', '*', '');
  const migrated = camps.length > 0 && 'holdout_pct' in camps[0];
  if (!migrated) log('NOTE: campaigns_v2.holdout_pct does not exist yet — supabase-migration-holdout.sql is not applied.\n');
  const live = camps.filter((c) => Number(c.holdout_pct || 0) > 0);
  if (live.length === 0 && !wantAll) {
    log('No campaign has holdout_pct > 0, so there are no arms to compare yet.');
    log('That is the expected state until the holdout is switched on.');
    log('Run with --all to dry-run the arithmetic against a hypothetical 10% split.');
    return;
  }

  // Group by the key the coin actually uses.
  const keyOf = (c) => c.parent_campaign_id || c.id;
  const groups = new Map();
  for (const c of (live.length ? live : camps)) {
    const k = keyOf(c);
    if (wantParent && k !== wantParent) continue;
    if (!groups.has(k)) groups.set(k, { pct: Number(c.holdout_pct || 0) || (wantAll ? 10 : 0), ids: [], name: c.name });
    groups.get(k).ids.push(c.id);
  }
  if (wantAll) log('DRY RUN: no holdout is live, so the split below is hypothetical (10%).\n');

  const seen = await pageAll('realtime_seen_members', 'phone_e164,cio_id,parent_campaign_id', '');
  // A phone carries several cio ids (836 of them do), so this is phone -> cio[] and never a Map
  // of one. Collapsing it silently drops the other accounts' deposits.
  const cioByPhone = new Map();
  for (const s of seen) {
    if (!s.cio_id) continue;
    if (!cioByPhone.has(s.phone_e164)) cioByPhone.set(s.phone_e164, new Set());
    cioByPhone.get(s.phone_e164).add(s.cio_id);
  }
  const deposits = await pageAll('cio_events', 'cio_id,occurred_at,amount_norm,event_name', '&event_name=eq.deposit_made');
  const depByCio = new Map();
  for (const d of deposits) {
    if (!depByCio.has(d.cio_id)) depByCio.set(d.cio_id, []);
    depByCio.get(d.cio_id).push(d);
  }

  for (const [key, g] of groups) {
    const rows = [];
    for (const id of g.ids) {
      rows.push(...await pageAll('campaign_numbers_v2', 'id,phone_e164,created_at,outcome', '&campaign_id=eq.' + id));
    }
    if (rows.length === 0) continue;

    // One row per player: the EARLIEST candidacy, which is when their 7-day window opens.
    const byPhone = new Map();
    for (const r of rows) {
      const prev = byPhone.get(r.phone_e164);
      if (!prev || r.created_at < prev.created_at) byPhone.set(r.phone_e164, r);
    }

    const arms = { withheld: [], called: [] };
    for (const [phone, r] of byPhone) {
      (isHeldOut(phone, key, g.pct) ? arms.withheld : arms.called).push(r);
    }

    const measure = (list) => {
      let depositors = 0, deposits = 0, eur = 0, identifiable = 0;
      for (const r of list) {
        const cios = cioByPhone.get(r.phone_e164);
        if (!cios || cios.size === 0) continue; // cannot be checked for deposits at all
        identifiable++;
        const open = new Date(r.created_at).getTime();
        const close = open + windowDays * 86400000;
        let any = false;
        for (const cio of cios) {
          for (const d of depByCio.get(cio) || []) {
            const t = new Date(d.occurred_at).getTime();
            if (t >= open && t < close) { any = true; deposits++; eur += Number(d.amount_norm || 0); }
          }
        }
        if (any) depositors++;
      }
      return { players: list.length, identifiable, depositors, deposits, eur };
    };

    const w = measure(arms.withheld), c = measure(arms.called);
    log('══ ' + (g.name || key).slice(0, 60) + '   holdout ' + g.pct + '%   window ' + windowDays + 'd');
    log('   parent ' + key + '   ' + g.ids.length + ' campaign(s), ' + byPhone.size + ' distinct players');
    log('');
    log('   arm         players  checkable  depositors      rate     95% CI              EUR');
    for (const [label, m] of [['withheld', w], ['called', c]]) {
      const [lo2, hi2] = wilson(m.depositors, m.identifiable);
      log('   ' + label.padEnd(11) + String(m.players).padStart(7) + String(m.identifiable).padStart(11) +
        String(m.depositors).padStart(12) + '  ' + (m.identifiable ? pctS(m.depositors / m.identifiable) : '—').padStart(8) +
        '  [' + pctS(lo2) + ', ' + pctS(hi2) + ']'.padEnd(3) + String(Math.round(m.eur)).padStart(11));
    }

    // ── the guard rails ──
    const notes = [];
    if (w.identifiable === 0) notes.push('THE WITHHELD ARM IS EMPTY. A small list plus a small share can round to zero players; the comparison is not running.');
    if (Math.min(w.identifiable, c.identifiable) < 300)
      notes.push('ARMS TOO SMALL to read. At a 0.6% base rate, detecting even a 5x lift needs about 300 per arm; a doubling needs about 3,300.');
    if (w.depositors + c.depositors < 20)
      notes.push('FEWER THAN 20 DEPOSITS IN TOTAL. Any gap here is noise. Report the arm sizes, not the rates.');
    const [wl, wh] = wilson(w.depositors, w.identifiable), [cl, ch] = wilson(c.depositors, c.identifiable);
    const overlap = !(wh < cl || ch < wl);
    notes.push(overlap
      ? 'The two intervals OVERLAP, so this data does not separate the arms. That is not evidence of no effect either.'
      : 'The intervals do NOT overlap. Worth a closer look, and still only one campaign.');
    log('');
    for (const n of notes) log('   • ' + n);
    log('');
  }
})();
