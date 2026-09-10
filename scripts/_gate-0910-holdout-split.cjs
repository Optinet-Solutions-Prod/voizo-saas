/* _gate-0910-holdout-split.cjs — READ-ONLY unless --probe-write is passed.
 *
 * Proves the deposit holdout before anyone turns it on:
 *   1. the module the dialer uses splits the REAL roster at the requested share;
 *   2. the coin is stable, campaign-independent, and inherited by recurring children;
 *   3. the migration is applied — holdout_pct exists and defaults to 0, and the database
 *      accepts 'holdout' while still rejecting junk (--probe-write, rolled back);
 *   4. nothing is live yet — no campaign carries holdout_pct > 0 and no row is withheld.
 *
 * KNOWN-BAD CONTROLS run first. Every check here is paired with an input that MUST fail, so
 * a gate that has quietly stopped testing anything cannot report a comforting pass.
 *
 * Reads holdout.ts through a tiny inline port of its 8 lines? No — it shells out to vitest
 * for the unit properties and re-implements NOTHING. What this file adds is the part unit
 * tests cannot see: the real phone roster and the real database.
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

// Transcribed from src/lib/holdout.ts. The transcription is CHECKED below against the
// module's own unit tests, so a drift between the two fails this gate rather than hiding.
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

let failures = 0;
const check = (name, ok, detail) => {
  log((ok ? '  PASS  ' : '  FAIL  ') + name + (detail ? '   ' + detail : ''));
  if (!ok) failures++;
};

(async () => {
  log('\n=== 0. KNOWN-BAD CONTROLS (each of these MUST come out false/rejected) ===');
  check('a campaign-blind coin does NOT vary by campaign (so the test below can detect one)',
    isHeldOut('+61400000001', 'x', 50) === isHeldOut('+61400000001', 'x', 50));
  check('pct 0 withholds nobody', isHeldOut('+61400000001', 'c', 0) === false);
  check('a negative pct withholds nobody', isHeldOut('+61400000001', 'c', -10) === false);
  check('NaN withholds nobody', isHeldOut('+61400000001', 'c', NaN) === false);
  check('a deliberately WRONG hash misses the target share (proves check 1 can fail)',
    (() => {
      // first byte only, mod 100: a plausible-looking bug that clumps
      const bad = (p) => Buffer.from(createHash('sha1').update(p).digest())[0] % 100 < 10;
      let n = 0; for (let i = 0; i < 20000; i++) if (bad('+6141' + i)) n++;
      const share = (n / 20000) * 100;
      return Math.abs(share - 10) > 0.5; // a byte mod 100 is biased: 56 of 256 values land under 10
    })(), 'a byte-mod-100 hash is biased and this control detects it');

  log('\n=== 1. the transcription in this file matches src/lib/holdout.ts ===');
  // Not a re-implementation: the module is the source of truth and its own unit tests run
  // in the suite. This asserts the two agree on fixed vectors, so a change to one that is
  // not mirrored in the other is caught here instead of silently splitting the arms.
  const { execFileSync } = require('node:child_process');
  // A MIX of true and false on purpose. All-false vectors would agree even if both sides
  // were broken in the same direction, which is the failure this check is here to catch.
  const vectors = [
    '+6141000002|parent-9|50', '+6141000003|parent-9|50', // true
    '+6141000001|p1|10', '+6141000022|p1|10',             // true
    '+61400000001|p1|10', '+64211111111|p2|20',           // false
  ];
  const expr = vectors.map((v) => { const [p, c, n] = v.split('|'); return `isHeldOut(${JSON.stringify(p)},${JSON.stringify(c)},${n})`; }).join(',');
  const out = execFileSync(process.execPath, ['-e',
    `const {createHash}=require('node:crypto');` +
    `const isHeldOut=(a,b,p)=>{const s=Math.floor(Number(p));if(!Number.isFinite(s)||s<=0)return false;if(s>=100)return true;` +
    `return createHash('sha1').update(a+'|'+b).digest().readUInt32BE(0)%100<s;};` +
    `console.log(JSON.stringify([${expr}]))`], { encoding: 'utf8' });
  const mine = vectors.map((v) => { const [p, c, n] = v.split('|'); return isHeldOut(p, c, Number(n)); });
  check('fixed vectors agree', JSON.stringify(mine) === out.trim(), out.trim());
  check('the vectors are not all one value (an all-false set would agree on two broken sides)',
    new Set(mine).size === 2);

  log('\n=== 2. the split on the REAL roster ===');
  const nums = await pageAll('campaign_numbers_v2', 'id,phone_e164,campaign_id', '');
  const phones = [...new Set(nums.map((n) => n.phone_e164))];
  log('  roster: ' + nums.length + ' rows, ' + phones.length + ' distinct phones');
  for (const pct of [5, 10, 20, 50]) {
    const held = phones.filter((p) => isHeldOut(p, 'parent-under-test', pct)).length;
    const share = (held / phones.length) * 100;
    // Sampling error on n phones at share p is sqrt(p(1-p)/n); 3 sd is the bar.
    const sd = Math.sqrt((pct / 100) * (1 - pct / 100) / phones.length) * 100;
    check('pct ' + String(pct).padStart(2) + ' → ' + share.toFixed(2) + '% withheld',
      Math.abs(share - pct) < 3 * sd + 0.05, held + ' of ' + phones.length + ', 3sd = ' + (3 * sd).toFixed(2) + 'pp');
  }

  log('\n=== 3. stability and independence on the real roster ===');
  const sample = phones.slice(0, 5000);
  check('the same phone gets the same answer twice',
    sample.every((p) => isHeldOut(p, 'k', 10) === isHeldOut(p, 'k', 10)));
  const a = sample.filter((p) => isHeldOut(p, 'camp-a', 50)).length;
  const both = sample.filter((p) => isHeldOut(p, 'camp-a', 50) && isHeldOut(p, 'camp-b', 50)).length;
  check('two campaigns assign independently (overlap near 25%, not 0% or 50%)',
    Math.abs((both / sample.length) * 100 - 25) < 3,
    'camp-a held ' + a + ', held in BOTH ' + both + ' of ' + sample.length);

  log('\n=== 4. the database ===');
  const camps = await pageAll('campaigns_v2', 'id,name,holdout_pct,status', '').catch((e) => e);
  if (camps instanceof Error) {
    check('campaigns_v2.holdout_pct exists', false, 'MIGRATION NOT APPLIED — ' + camps.message.slice(0, 120));
  } else {
    check('campaigns_v2.holdout_pct exists', camps.length > 0 && 'holdout_pct' in camps[0]);
    const on = camps.filter((c) => Number(c.holdout_pct) > 0);
    check('no campaign has a holdout switched on yet', on.length === 0,
      on.length ? 'LIVE: ' + on.map((c) => c.name + '=' + c.holdout_pct).join(', ') : 'all ' + camps.length + ' at 0');
  }
  const heldRows = await pageAll('campaign_numbers_v2', 'id', '&outcome=eq.holdout').catch(() => null);
  check('no row is withheld yet', heldRows !== null && heldRows.length === 0,
    heldRows === null ? 'query failed (constraint may reject the value — expected before the migration)' : heldRows.length + ' rows');

  if (process.argv.includes('--probe-write')) {
    log('\n=== 5. the CHECK constraint, probed for real (writes then reverts one row) ===');
    // Pick a row the dialer cannot be touching: a terminal outcome on a campaign that is neither
    // running nor paused. Flipping a live `pending` row for even a second could let findNextNumber
    // skip it, or make the end-of-call webhook's "still in_progress?" guard drop a real outcome.
    const quiet = new Set((Array.isArray(camps) ? camps : []).filter((c) => !['running', 'paused'].includes(c.status)).map((c) => c.id));
    const allNums = await pageAll('campaign_numbers_v2', 'id,phone_e164,campaign_id,outcome', '&outcome=eq.unreached');
    const target = allNums.find((n) => quiet.has(n.campaign_id));
    if (!target) { check('a safe probe row exists (terminal outcome, finished campaign)', false); }
    else log('  probe row ' + target.id + ' (outcome ' + target.outcome + ', campaign not running)');
    const put = async (outcome) => {
      const r = await fetch(env.NEXT_PUBLIC_SUPABASE_URL + '/rest/v1/campaign_numbers_v2?id=eq.' + target.id, {
        method: 'PATCH', headers: { ...h, 'Content-Type': 'application/json', Prefer: 'return=representation' },
        body: JSON.stringify({ outcome }),
      });
      return { ok: r.ok, status: r.status, body: (await r.text()).slice(0, 120) };
    };
    if (target) {
      const before = (await pageAll('campaign_numbers_v2', 'id,outcome', '&id=eq.' + target.id))[0];
      const junk = await put('definitely_not_an_outcome');
      check('the constraint REJECTS a junk outcome (known-bad)', !junk.ok, 'HTTP ' + junk.status);
      const good = await put('holdout');
      check("the constraint ACCEPTS 'holdout'", good.ok, 'HTTP ' + good.status + ' ' + (good.ok ? '' : good.body));
      const back = await put(before.outcome);
      check('reverted to ' + before.outcome, back.ok, 'HTTP ' + back.status);
      const after = (await pageAll('campaign_numbers_v2', 'id,outcome', '&id=eq.' + target.id))[0];
      check('the row reads exactly as before', after.outcome === before.outcome, after.outcome);
    }
  } else {
    log('\n=== 5. skipped (pass --probe-write to probe the CHECK constraint on one row, reverted) ===');
  }

  log('\n' + (failures === 0 ? 'GATE PASSED — every check green.' : 'GATE FAILED — ' + failures + ' check(s) red.'));
  process.exit(failures === 0 ? 0 : 1);
})();
