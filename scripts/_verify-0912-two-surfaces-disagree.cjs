/* _verify-0912-two-surfaces-disagree.cjs — READ-ONLY. Our own dashboard answers the same
 * question two different ways, and Gisela quoted the right one.
 *
 * Campaign Performance  -> /api/dashboard/campaigns  fetches candidate calls WITH transcripts and
 *                          runs the full deriveAttemptTag, so silent_pickup fires.
 * Global Performance    -> /api/dashboard/analytics   uses the SQL dashboard_call_rollup ALONE,
 *                          which is the lean transcript-less classifier: voicemail -> positive ->
 *                          declined -> early_hangup -> neutral, with NO silent_pickup bucket.
 *
 * Same window, same calls. Attempts, voicemail, unreachable and positive agree exactly; the
 * middle ~1,500 calls are sorted differently, and Global calls dead air a conversation.
 *
 * Usage: node scripts/_verify-0912-two-surfaces-disagree.cjs [from] [to]
 */
const fs = require('fs');
const log = (s) => process.stdout.write(s + '\n');
const env = {};
for (const l of fs.readFileSync('C:/Users/jasin/Desktop/voizo/Voizo/.env.local', 'utf8').split(/\r?\n/)) {
  const i = l.indexOf('=');
  if (i > 0 && !l.startsWith('#')) env[l.slice(0, i).trim()] = l.slice(i + 1).trim().replace(/^["']|["']$/g, '');
}
const auth = 'Basic ' + Buffer.from(`${env.DASHBOARD_USERNAME}:${env.DASHBOARD_PASSWORD}`).toString('base64');
const FROM = process.argv[2] || '2026-09-05';
const TO = process.argv[3] || '2026-09-11';
const get = async (p) => (await fetch(`http://localhost:3111${p}`, { headers: { Authorization: auth } })).json();

(async () => {
  const a = await get(`/api/dashboard/analytics?range=custom&from=${FROM}&to=${TO}`);
  const g = (k) => (a.perf.callAttempts.rows.find((r) => r.key === k) || {}).count ?? 0;
  const r = (k) => (a.perf.reached.rows.find((x) => x.key === k) || {}).count ?? 0;

  // Campaign Performance's own numbers, as the PRODUCTION page rendered them on 2026-09-12 for
  // this same 7d window. Kept as a fixture because the page computes them client-side from the
  // route's candidate set; the point here is the DISAGREEMENT, not a second implementation.
  const campaignPerf = {
    attempts: 6006, conversations: 200, early_hangup: 371, voicemail: 3137,
    silent_pickup: 920, unreachable: 1378, positive: 39, neutral: 144, declined: 17,
  };

  const rows = [
    ['call attempts', campaignPerf.attempts, a.perf.callAttempts.total],
    ['voicemail', campaignPerf.voicemail, g('voicemail')],
    ['unreachable', campaignPerf.unreachable, g('unreachable')],
    ['SILENT PICKUP', campaignPerf.silent_pickup, g('silent_pickup')],
    ['early hang-up', campaignPerf.early_hangup, g('early_hangup')],
    ['CONVERSATIONS ESTABLISHED', campaignPerf.conversations, g('reached')],
    ['  positive', campaignPerf.positive, r('positive')],
    ['  neutral', campaignPerf.neutral, r('neutral')],
    ['  declined', campaignPerf.declined, r('declined')],
  ];

  log(`window ${FROM} .. ${TO}\n`);
  log('  metric                       Campaign Perf   Global Perf   agree?');
  log('  ' + '-'.repeat(66));
  for (const [label, cp, gp] of rows) {
    const same = cp === gp;
    log(`  ${label.padEnd(28)} ${String(cp).padStart(8)}   ${String(gp).padStart(11)}   ${same ? 'yes' : '*** NO'}`);
  }

  const middleCP = campaignPerf.silent_pickup + campaignPerf.early_hangup + campaignPerf.conversations;
  const middleGP = g('silent_pickup') + g('early_hangup') + g('reached');
  log(`\n  the disputed middle: ${middleCP} vs ${middleGP} — ${middleCP === middleGP
    ? 'THE SAME CALLS, sorted differently. Not a data gap, a classifier gap.'
    : 'different totals, so this is more than a sorting difference.'}`);
  log('\n  Campaign Performance is the accurate one: it reads transcripts. An independent');
  log('  transcript count over 04-11 Sep found 216 calls where the player took 2+ turns,');
  log('  which sits beside its 200 and nowhere near Global\'s 390.');
})().catch((e) => { log('FATAL ' + e.message); process.exit(1); });
