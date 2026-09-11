/* _measure-0912-silent-pickup-cost.cjs — READ-ONLY. What does the missing silent_pickup bucket cost?
 *
 * dashboard_call_rollup implements the LEAN classifier: voicemail -> positive -> declined ->
 * early_hangup(lean) -> neutral. There is no silent_pickup bucket, because the SQL never looks at
 * the transcript. So a call where the line answered and NOBODY EVER SPOKE lands in `neutral`,
 * and `neutral` is a TEXTABLE bucket.
 *
 * Two questions, both answerable from data we already store:
 *   1. How many "Conversations established" never had a word from the player?
 *   2. How many TEXTS did we pay for to players who never spoke?
 *
 * Usage: node scripts/_measure-0912-silent-pickup-cost.cjs [fromISO] [toISO]
 */
const fs = require('fs');
const log = (s) => process.stdout.write(s + '\n');
const env = {};
for (const l of fs.readFileSync('C:/Users/jasin/Desktop/voizo/Voizo/.env.local', 'utf8').split(/\r?\n/)) {
  const i = l.indexOf('=');
  if (i > 0 && !l.startsWith('#')) env[l.slice(0, i).trim()] = l.slice(i + 1).trim().replace(/^["']|["']$/g, '');
}
const h = { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: 'Bearer ' + env.SUPABASE_SERVICE_ROLE_KEY };
const FROM = process.argv[2] || '2026-09-04T00:00:00Z';
const TO = process.argv[3] || '2026-09-12T00:00:00Z';

async function pageAll(t, qs, step = 500) {
  const out = [];
  for (let f = 0; ; f += step) {
    const r = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/${t}?${qs}`, {
      headers: { ...h, Range: `${f}-${f + step - 1}`, 'Range-Unit': 'items', Prefer: 'count=exact' },
    });
    if (!r.ok) throw new Error(`${t} ${r.status} ${(await r.text()).slice(0, 200)}`);
    const c = await r.json();
    out.push(...c);
    const tot = Number(String(r.headers.get('content-range') || '').split('/')[1]);
    if (c.length < step) {
      if (Number.isFinite(tot) && out.length !== tot) throw new Error(`PAGING INCOMPLETE ${t}: ${out.length}/${tot}`);
      return out;
    }
  }
}

/** The player said something. A voicemail GREETING also transcribes as a User turn, which is why
 *  every count below is taken on non-voicemail calls only. */
const spokeTurns = (c) => {
  const t = c.transcript && typeof c.transcript.text === 'string' ? c.transcript.text : '';
  return t.split('\n').filter((l) => /^(User|Customer|Human):/i.test(l)).length;
};

(async () => {
  const calls = await pageAll('calls_v2',
    `select=id,voicemail,goal_reached,ended_reason,duration_seconds,transcript&created_at=gte.${FROM}&created_at=lt.${TO}`);
  const byId = new Map(calls.map((c) => [c.id, c]));
  log(`calls ${FROM.slice(0, 10)} .. ${TO.slice(0, 10)}: ${calls.length}\n`);

  // The lean rule the SQL actually applies (2026-08-04_dashboard_rollup_rpc.sql:56).
  const EARLY = new Set(['customer-did-not-answer', 'customer-busy', 'customer-did-not-give-microphone-permission']);
  const leanEarly = (c) => EARLY.has(String(c.ended_reason)) || (c.duration_seconds !== null && c.duration_seconds < 15);

  const connectedish = calls.filter((c) => c.voicemail !== true && c.goal_reached !== true);
  const neutralish = connectedish.filter((c) => !leanEarly(c));
  const silentNeutral = neutralish.filter((c) => spokeTurns(c) === 0);
  log('── 1. what the dashboard calls a conversation ──');
  log(`  non-voicemail, non-goal calls            ${String(connectedish.length).padStart(5)}`);
  log(`  of those, NOT lean-early-hangup          ${String(neutralish.length).padStart(5)}   <- these read as "neutral"/reached`);
  log(`  of those, the player NEVER SPOKE         ${String(silentNeutral.length).padStart(5)}   <- would be silent_pickup`);
  log(`  = ${(100 * silentNeutral.length / Math.max(1, neutralish.length)).toFixed(1)}% of the neutral bucket is dead air`);

  // ── 2. the money question ──
  const sms = await pageAll('sms_messages_v2',
    `select=id,call_id,status,price_eur,parts,created_at&created_at=gte.${FROM}&created_at=lt.${TO}`);
  log(`\n── 2. texts we paid for ──`);
  log(`  texts sent in the window                 ${String(sms.length).padStart(5)}`);
  const withCall = sms.filter((s) => s.call_id && byId.has(s.call_id));
  log(`  linked to a call we can read             ${String(withCall.length).padStart(5)}`);
  const toSilent = withCall.filter((s) => {
    const c = byId.get(s.call_id);
    return c.voicemail !== true && c.goal_reached !== true && spokeTurns(c) === 0;
  });
  const toVoicemail = withCall.filter((s) => byId.get(s.call_id).voicemail === true);
  const toSpoke = withCall.filter((s) => spokeTurns(byId.get(s.call_id)) > 0 && byId.get(s.call_id).voicemail !== true);
  log(`    to a player who SPOKE                  ${String(toSpoke.length).padStart(5)}`);
  log(`    to a VOICEMAIL                         ${String(toVoicemail.length).padStart(5)}`);
  log(`    to a player who NEVER SPOKE            ${String(toSilent.length).padStart(5)}   <- paid for, no human evidence`);
  const priced = withCall.filter((s) => typeof s.price_eur === 'number');
  const avg = priced.length ? priced.reduce((a, s) => a + s.price_eur, 0) / priced.length : null;
  if (avg !== null) {
    log(`\n  measured price per text (Mobivate, ${priced.length} priced rows): EUR ${avg.toFixed(4)}`);
    log(`  spend on texts to players who never spoke:  EUR ${(avg * toSilent.length).toFixed(2)} in this window`);
    log(`  annualised at this rate:                    EUR ${(avg * toSilent.length * 365 / 8).toFixed(0)}`);
  } else {
    log('\n  no priced rows — cannot cost it, and will not guess.');
  }
})().catch((e) => { log('FATAL ' + e.message); process.exit(1); });
