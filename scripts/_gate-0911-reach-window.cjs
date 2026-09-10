/* _gate-0911-reach-window.cjs — READ-ONLY. The merged, windowed Reach card, proved.
 *
 * Drives the RUNNING app (localhost:3111), so the whole chain is exercised: scope resolution, the
 * window parse, the family rule, search sanitising, audience_lane_reach_window, the mapping.
 *
 *   0. SELF-TEST. The JavaScript rules this gate measures WITH are checked against hand-built
 *      calls first. An instrument that has stopped measuring must not be able to pass.
 *   1. KNOWN-GOOD, ALL TIME. Nine of the card's numbers must equal audience_lane_reach EXACTLY.
 *      That function is the dashboard's own lean rule and predates this work, so it is a reference
 *      the new function cannot have influenced. At All the window holds every call and text, so
 *      "in the window" and "ever" are the same set and the two must agree to the row.
 *   2. KNOWN-GOOD, 7d. The WHOLE card recomputed in JavaScript from raw rows — campaign_numbers_v2,
 *      calls_v2, sms_messages_v2, cio_track_events, cio_events and the owner bridge — with the
 *      strict rule transcribed from dashboardAnalytics.ts + transcriptClassify.ts (the same
 *      transcription _gate-0910-strict-reached.cjs matched against the SQL on all 79,270 calls).
 *      No SQL function is involved on the reference side. Every column must match exactly.
 *   3. THE 31-vs-35 QUESTION. The card's `spoke` counts players spoken to INSIDE the window; the
 *      Depositors table's "Spoke with them" counts players spoken to EVER whose last touch falls in
 *      the window. Those are different questions and the numbers differ. This part proves the
 *      relationship rather than asserting a false equality: the card's set must be a strict SUBSET
 *      of the table's, and every player in the difference must have spoken only BEFORE the window.
 *   4. KNOWN-BAD, ORDERING. spoke <= answered <= dialled <= contacted, text_delivered <= texted <=
 *      contacted, the three message fates <= msgs, depositors <= contacted. On six views.
 *   5. KNOWN-BAD, FILTERS. A bogus contact value falls back to "any"; a bogus family yields ZERO,
 *      never everyone; spoke and never_spoke must differ.
 *   6. THE OWNER BRIDGE. Depositors against audience_lane_contact_window, the function this card
 *      replaces. It attributed a CRM id to its NEWEST phone where every other Audience function
 *      uses the smallest, so a small divergence is expected and correct. Both printed; fails only
 *      above a handful.
 *   7. TIME. All brands, all markets, all time: under the 8-second statement limit.
 *
 * Before the SQL is applied every part reports the route's `unavailableReach` and the gate fails.
 */
const fs = require('fs');
const log = (s) => process.stdout.write(s + '\n');
const env = {};
for (const l of fs.readFileSync('C:/Users/jasin/Desktop/voizo/Voizo/.env.local', 'utf8').split(/\r?\n/)) {
  const i = l.indexOf('=');
  if (i > 0 && !l.startsWith('#')) env[l.slice(0, i).trim()] = l.slice(i + 1).trim().replace(/^["']|["']$/g, '');
}
const auth = 'Basic ' + Buffer.from(env.DASHBOARD_USERNAME + ':' + env.DASHBOARD_PASSWORD).toString('base64');
const h = { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: 'Bearer ' + env.SUPABASE_SERVICE_ROLE_KEY };

let failures = 0;
const check = (name, ok, detail) => { log((ok ? '  PASS  ' : '  FAIL  ') + name + (detail ? '   ' + detail : '')); if (!ok) failures++; };
const get = async (p) => {
  const t0 = Date.now();
  const r = await fetch('http://localhost:3111' + p, { headers: { Authorization: auth } });
  if (!r.ok) throw new Error(p + ' HTTP ' + r.status);
  return { json: await r.json(), ms: Date.now() - t0 };
};
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

/** PostgREST caps every read at 1000 and ignores &limit, so page with Range and assert the count. */
async function pageAll(table, select, extra) {
  const out = []; const step = 1000;
  for (let from = 0; ; from += step) {
    // Supabase sits behind Cloudflare and answers a 520 now and then under this much paging
    // (seen 2026-09-11 on realtime_seen_members). A gate that dies on a transient blip reports a
    // fault that is not there, so retry the PAGE twice before believing it. A 4xx is real: no retry.
    let r = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      r = await fetch(env.NEXT_PUBLIC_SUPABASE_URL + '/rest/v1/' + table + '?select=' + select + (extra || ''), {
        headers: { ...h, Range: from + '-' + (from + step - 1), 'Range-Unit': 'items', Prefer: 'count=exact' },
      });
      if (r.ok || r.status < 500) break;
      await new Promise((x) => setTimeout(x, 2000 * (attempt + 1)));
    }
    if (!r.ok) throw new Error(table + ' ' + r.status + ' ' + (await r.text()).slice(0, 200));
    const chunk = await r.json(); out.push(...chunk);
    const total = Number(String(r.headers.get('content-range') || '').split('/')[1]);
    if (chunk.length < step) {
      if (Number.isFinite(total) && out.length !== total) throw new Error('PAGING INCOMPLETE ' + table + ': ' + out.length + '/' + total);
      return out;
    }
  }
}

// ── the rules, transcribed from dashboardAnalytics.ts + transcriptClassify.ts ──
// Identical to the transcription in _gate-0910-strict-reached.cjs, which matched the SQL function
// call for call on all 79,270 calls. Kept here rather than imported: a reference that imports the
// thing it checks is not a reference.
const CONNECTED = new Set(['completed', 'answered']);
const BAIL_ENDINGS = new Set(['customer-ended-call', 'assistant-ended-call',
  'assistant-said-end-call-phrase', 'assistant-ended-call-after-message-spoken']);
const EARLY_HANGUP_SEC = 15;
const isConnected = (s) => CONNECTED.has(s ?? '');
const isAgentTimeout = (r) => !!r && (String(r).startsWith('pipeline-error') || r === 'assistant-not-responding');
const transcriptText = (t) => (!t ? '' : typeof t === 'string' ? t : (t.text ?? ''));
function parseTranscriptTurns(tr) {
  const turns = [], lines = String(tr).split(/\r?\n/);
  let speaker = 'unknown', buf = [];
  const flush = () => { const text = buf.join(' ').trim(); if (text) turns.push({ speaker, text }); buf = []; };
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (/^\d{1,2}:\d{2}(:\d{2})?\s*(AM|PM)?(\s*\(\+?[\d:.]+\))?$/i.test(line)) continue;
    if (/^(?:AI|Assistant|Bot)$/i.test(line)) { flush(); speaker = 'ai'; continue; }
    if (/^(?:User|Customer|Caller|Human)$/i.test(line)) { flush(); speaker = 'user'; continue; }
    const ai = line.match(/^(?:AI|Assistant|Bot):\s*(.*)$/i);
    if (ai) { flush(); speaker = 'ai'; if (ai[1]) buf.push(ai[1]); continue; }
    const us = line.match(/^(?:User|Customer|Caller|Human):\s*(.*)$/i);
    if (us) { flush(); speaker = 'user'; if (us[1]) buf.push(us[1]); continue; }
    buf.push(line);
  }
  flush();
  return turns;
}
const userTurns = (tr) => (!tr || !String(tr).trim() ? 0
  : parseTranscriptTurns(tr).filter((t) => t.speaker === 'user' && t.text.trim().length >= 2).length);
function isEarlyHangup(c) {
  if (c.ended_reason === 'silence-timed-out') return true;
  if (userTurns(transcriptText(c.transcript)) > 1) return false;
  if (BAIL_ENDINGS.has(c.ended_reason ?? '')) return true;
  if (typeof c.duration_seconds === 'number' && c.duration_seconds < EARLY_HANGUP_SEC) return true;
  return false;
}
function strictSpoke(c, declinedContact) {
  if (c.goal_reached === true) return true;
  if (!isConnected(c.status)) return false;
  if (c.voicemail === true) return false;
  if (isAgentTimeout(c.ended_reason)) return true;
  if (userTurns(transcriptText(c.transcript)) === 0) return false;
  if (declinedContact) return true;
  return !isEarlyHangup(c);
}
/** The dashboard's LEAN rule, which the card calls "Answered". */
const leanAnswered = (c) => isConnected(c.status) && !(c.voicemail === true && c.goal_reached !== true);

(async () => {
  log('\n=== 0. SELF-TEST: the instrument, before it measures anything ===');
  check('a silent pickup is ANSWERED but not SPOKE (the two rules must differ)',
    leanAnswered({ status: 'completed', voicemail: false }) === true &&
    strictSpoke({ status: 'completed', voicemail: false, transcript: { text: 'AI: hello?' } }, false) === false);
  check('an early hang-up is ANSWERED but not SPOKE',
    strictSpoke({ status: 'completed', voicemail: false, duration_seconds: 4,
      ended_reason: 'customer-ended-call', transcript: { text: 'AI: hi\nUser: no' } }, false) === false);
  check('a real conversation IS SPOKE',
    strictSpoke({ status: 'completed', voicemail: false, duration_seconds: 60,
      ended_reason: 'assistant-said-end-call-phrase',
      transcript: { text: 'AI: hi\nUser: yes go on\nAI: ok\nUser: sounds good' } }, false) === true);
  check('a declined contact IS SPOKE (a refusal is a conversation)',
    strictSpoke({ status: 'completed', voicemail: false, duration_seconds: 4,
      ended_reason: 'customer-ended-call', transcript: { text: 'AI: hi\nUser: not interested' } }, true) === true);
  check('voicemail is neither', leanAnswered({ status: 'completed', voicemail: true, goal_reached: false }) === false &&
    strictSpoke({ status: 'completed', voicemail: true }, false) === false);
  check('a no-answer is neither', leanAnswered({ status: 'no-answer' }) === false && strictSpoke({ status: 'no-answer' }, false) === false);

  // ── the card, from the running app ──
  const card = async (qs) => {
    const { json, ms } = await get('/api/audience/deposits?' + qs);
    if (json.unavailableReach) throw new Error('reach block unavailable: ' + json.unavailableReach);
    return { r: json.reach, from: json.from, to: json.to, ms };
  };

  log('\n=== 1. KNOWN-GOOD, ALL TIME: nine columns against audience_lane_reach ===');
  const all = await card('range=lifetime');
  const lr = await fetch(env.NEXT_PUBLIC_SUPABASE_URL + '/rest/v1/rpc/audience_lane_reach', {
    method: 'POST', headers: { ...h, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_campaign_ids: (await pageAll('campaigns_v2', 'id,source,is_test', '&order=id'))
      .filter((c) => c.source !== 'ghost_portal' && c.is_test !== true).map((c) => c.id) }),
  }).then((r) => r.json()).then((x) => x[0]);
  for (const [w, ref] of [['dialled', 'dialled'], ['answered', 'spoke_lean'], ['texted', 'texted'],
    ['textDelivered', 'text_delivered'], ['textedNotAnswered', 'texted_not_spoken'], ['msgs', 'msgs'],
    ['msgsDelivered', 'msgs_delivered'], ['msgsFailed', 'msgs_failed'], ['msgsUnconfirmed', 'msgs_unconfirmed']]) {
    check('all time  ' + w + ' == audience_lane_reach.' + ref, all.r[w] === lr[ref], all.r[w] + ' vs ' + lr[ref]);
  }
  check('all time  contacted == dialled OR texted, and never exceeds members',
    all.r.contacted >= all.r.dialled && all.r.contacted >= all.r.texted && all.r.contacted <= lr.members,
    'contacted ' + all.r.contacted + ' · members ' + lr.members);
  await pause(3000);

  log('\n=== 2. KNOWN-GOOD, 7d: the whole card recomputed in JavaScript from raw rows ===');
  const w7 = await card('range=7d');
  const FROM = w7.from, TO = w7.to;
  log('  window ' + FROM + ' → ' + TO);
  const camps = await pageAll('campaigns_v2', 'id,source,is_test,cio_workspace,parent_campaign_id', '&order=id');
  const liveIds = new Set(camps.filter((c) => c.source !== 'ghost_portal' && c.is_test !== true).map((c) => c.id));
  const nums = (await pageAll('campaign_numbers_v2', 'id,phone_e164,campaign_id,outcome,cio_id', '&order=id'))
    .filter((n) => liveIds.has(n.campaign_id) && n.phone_e164);
  const numById = new Map(nums.map((n) => [n.id, n]));
  log('  scope numbers ' + nums.length);
  const inWin = '&created_at=gte.' + FROM + '&created_at=lt.' + TO;
  const calls = (await pageAll('calls_v2', 'campaign_number_id,status,voicemail,goal_reached,duration_seconds,ended_reason,transcript,created_at', inWin + '&order=id'))
    .filter((c) => numById.has(c.campaign_number_id));
  const sms = (await pageAll('sms_messages_v2', 'campaign_number_id,status,created_at', inWin + '&order=id'))
    .filter((m) => numById.has(m.campaign_number_id));
  log('  in-window calls ' + calls.length + ' · texts ' + sms.length);
  // per phone
  const P = new Map();
  const of = (phone) => { let x = P.get(phone); if (!x) { x = { dialled: false, answered: false, spoke: false, texted: false, delivered: false, first: null }; P.set(phone, x); } return x; };
  const touch = (x, at) => { if (!x.first || at < x.first) x.first = at; };
  for (const c of calls) {
    const n = numById.get(c.campaign_number_id), x = of(n.phone_e164);
    x.dialled = true; touch(x, c.created_at);
    if (leanAnswered(c)) x.answered = true;
    if (strictSpoke(c, n.outcome === 'declined_offer')) x.spoke = true;
  }
  for (const m of sms) {
    const n = numById.get(m.campaign_number_id), x = of(n.phone_e164);
    if (m.status === 'sent' || m.status === 'delivered') { x.texted = true; touch(x, m.created_at); }
    if (m.status === 'delivered') x.delivered = true;
  }
  const V = [...P.values()];
  const js = {
    contacted: V.filter((x) => x.dialled || x.texted).length,
    dialled: V.filter((x) => x.dialled).length,
    answered: V.filter((x) => x.answered).length,
    spoke: V.filter((x) => x.spoke).length,
    texted: V.filter((x) => x.texted).length,
    textDelivered: V.filter((x) => x.delivered).length,
    textedNotAnswered: V.filter((x) => x.texted && !x.answered).length,
    msgs: sms.length,
    msgsDelivered: sms.filter((m) => m.status === 'delivered').length,
    msgsFailed: sms.filter((m) => m.status === 'failed' || m.status === 'undelivered').length,
    msgsUnconfirmed: sms.filter((m) => m.status === 'sent').length,
  };
  // emailed: our own ledger, joined on campaign_number_id
  const mail = (await pageAll('cio_track_events', 'campaign_number_id,event_name,status,sent_at,created_at', '&order=id'))
    .filter((t) => t.event_name === 'voizo_call_followup' && t.status === 'sent' && numById.has(t.campaign_number_id));
  js.emailed = new Set(mail.filter((t) => { const at = t.sent_at || t.created_at; return at >= FROM && at < TO; })
    .map((t) => numById.get(t.campaign_number_id).phone_e164)).size;
  for (const k of Object.keys(js)) check('7d  ' + k, w7.r[k] === js[k], w7.r[k] + ' vs JS ' + js[k]);

  // depositors: the owner bridge, MIN(phone) per (workspace, cio_id), rebuilt in JS
  const wsOf = new Map(camps.map((c) => [c.id, c.cio_workspace || 'lucky7even']));
  const ident = new Map(); // workspace|cio -> Set(phone)
  const add = (ws, cio, phone) => { if (!cio || !phone) return; const k = ws + '|' + cio; const s = ident.get(k) || new Set(); s.add(phone); ident.set(k, s); };
  for (const n of nums) add(wsOf.get(n.campaign_id), n.cio_id, n.phone_e164);
  const seen = await pageAll('realtime_seen_members', 'phone_e164,cio_id,parent_campaign_id', '&order=phone_e164,cio_id');
  const scopePhones = new Map(); // phone -> Set(workspace)
  for (const n of nums) { const s = scopePhones.get(n.phone_e164) || new Set(); s.add(wsOf.get(n.campaign_id)); scopePhones.set(n.phone_e164, s); }
  for (const rs of seen) {
    const ws = wsOf.get(rs.parent_campaign_id);
    if (ws && scopePhones.get(rs.phone_e164) && scopePhones.get(rs.phone_e164).has(ws)) add(ws, rs.cio_id, rs.phone_e164);
  }
  const owner = new Map(); // workspace|cio -> min phone
  for (const [k, s] of ident) owner.set(k, [...s].sort()[0]);
  const dep = await pageAll('cio_events', 'cio_id,workspace,event_name,occurred_at,amount_norm', "&event_name=eq.deposit_made&order=cio_id,occurred_at");
  const depositors = new Set(); let deposits = 0, eur = 0;
  for (const e of dep) {
    const phone = owner.get(e.workspace + '|' + e.cio_id);
    if (!phone) continue;
    const x = P.get(phone);
    if (!x || !(x.dialled || x.texted) || !x.first) continue;
    if (e.occurred_at >= x.first && e.occurred_at < TO) { depositors.add(phone); deposits++; eur += Number(e.amount_norm) || 0; }
  }
  check('7d  depositors', w7.r.depositors === depositors.size, w7.r.depositors + ' vs JS ' + depositors.size);
  check('7d  deposits', w7.r.deposits === deposits, w7.r.deposits + ' vs JS ' + deposits);
  check('7d  amountEur', Math.abs(w7.r.amountEur - eur) < 0.005, w7.r.amountEur.toFixed(4) + ' vs JS ' + eur.toFixed(4));
  await pause(3000);

  log('\n=== 3. The card\'s `spoke` vs the Depositors table\'s "Spoke with them" ===');
  log('  Different questions: the card counts players spoken to INSIDE the window; the table counts');
  log('  players spoken to EVER whose last touch falls in the window. The card must be a SUBSET.');
  const cardPhones = new Set([...P.entries()].filter(([, x]) => x.spoke).map(([p]) => p));
  const tablePhones = new Set();
  for (let page = 1; ; page++) {
    const j = (await get('/api/audience/players?range=7d&contact=spoke&page=' + page)).json;
    for (const row of j.rows) tablePhones.add(row.phone);
    if (tablePhones.size >= j.total || !j.rows.length) break;
    await pause(1000);
  }
  log('  card spoke = ' + w7.r.spoke + '   table "Spoke with them" total = ' + tablePhones.size);
  // Spoke in the window implies spoke ever, and a call in the window puts last contact in the
  // window, so the card's set must sit entirely inside the table's. If it ever does not, the two
  // surfaces have stopped meaning the same thing by "spoke" and the card is the one that is wrong.
  const notInTable = [...cardPhones].filter((p) => !tablePhones.has(p));
  check('every player the card counts is also in the table\'s set (a strict subset)',
    notInTable.length === 0, notInTable.length ? notInTable.slice(0, 5).join(', ') : cardPhones.size + ' of ' + tablePhones.size);
  const extra = [...tablePhones].filter((p) => !cardPhones.has(p));
  check('the difference is explained: every extra player was NOT spoken to inside the window',
    extra.every((p) => !(P.get(p) || {}).spoke),
    extra.length + ' spoke before the window and were contacted again inside it');
  await pause(3000);

  log('\n=== 4. KNOWN-BAD, ORDERING: the card can never draw a bar wider than its denominator ===');
  const views = [['range=7d', '7d'], ['range=30d', '30d'], ['range=lifetime', 'All'],
    ['range=7d&country=Australia', '7d AU'], ['range=7d&brand=fortuneplay', '7d FortunePlay'],
    ['range=30d&contact=spoke', '30d Spoke with them']];
  for (const [qs, name] of views) {
    const { r } = await card(qs);
    check(name + '  spoke <= answered <= dialled <= contacted',
      r.spoke <= r.answered && r.answered <= r.dialled && r.dialled <= r.contacted,
      [r.spoke, r.answered, r.dialled, r.contacted].join(' <= '));
    check(name + '  text_delivered <= texted <= contacted',
      r.textDelivered <= r.texted && r.texted <= r.contacted, [r.textDelivered, r.texted, r.contacted].join(' <= '));
    check(name + '  the three message fates never exceed the messages',
      r.msgsDelivered + r.msgsFailed + r.msgsUnconfirmed <= r.msgs,
      r.msgsDelivered + '+' + r.msgsFailed + '+' + r.msgsUnconfirmed + ' <= ' + r.msgs);
    check(name + '  depositors <= contacted, and deposits >= depositors',
      r.depositors <= r.contacted && r.deposits >= r.depositors, r.depositors + ' / ' + r.deposits + ' / ' + r.contacted);
    await pause(1500);
  }

  log('\n=== 5. KNOWN-BAD, FILTERS ===');
  const base = (await card('range=7d')).r;
  const bogusContact = (await card('range=7d&contact=banana')).r;
  check('a bogus contact value falls back to "any"', JSON.stringify(bogusContact) === JSON.stringify(base));
  await pause(1500);
  const bogusFamily = (await card('range=7d&family=grp%3Anot-a-family')).r;
  check('a bogus family yields ZERO, never everyone', bogusFamily.contacted === 0, 'contacted ' + bogusFamily.contacted);
  await pause(1500);
  const spoke = (await card('range=7d&contact=spoke')).r;
  const never = (await card('range=7d&contact=never_spoke')).r;
  check('spoke and never_spoke are different populations', spoke.contacted !== never.contacted,
    spoke.contacted + ' vs ' + never.contacted);
  check('the two contact filters partition the unfiltered card',
    spoke.contacted + never.contacted === base.contacted,
    spoke.contacted + ' + ' + never.contacted + ' = ' + (spoke.contacted + never.contacted) + ' vs ' + base.contacted);
  await pause(3000);

  log('\n=== 6. THE OWNER BRIDGE: depositors vs audience_lane_contact_window, the card this replaces ===');
  const oldFn = await fetch(env.NEXT_PUBLIC_SUPABASE_URL + '/rest/v1/rpc/audience_lane_contact_window', {
    method: 'POST', headers: { ...h, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_campaign_ids: [...liveIds], p_from: FROM, p_to: TO }),
  }).then((r) => r.json()).then((x) => x[0]);
  log('  old function: contacted ' + oldFn.contacted + ' · depositors ' + oldFn.depositors + ' · EUR ' + Number(oldFn.amount_eur).toFixed(2));
  log('  new card:     contacted ' + w7.r.contacted + ' · depositors ' + w7.r.depositors + ' · EUR ' + w7.r.amountEur.toFixed(2));
  check('depositors diverge by no more than a handful (newest-phone vs smallest-phone bridge)',
    Math.abs(w7.r.depositors - oldFn.depositors) <= 5, 'difference ' + (w7.r.depositors - oldFn.depositors));
  check('contacted is unchanged by the rewrite', w7.r.contacted === Number(oldFn.contacted),
    w7.r.contacted + ' vs ' + oldFn.contacted);

  log('\n=== 7. TIME ===');
  await pause(3000);
  const t = await card('range=lifetime');
  check('all brands, all markets, all time under the 8 s statement limit', t.ms < 8000, t.ms + ' ms (route, both blocks)');

  log('\n' + (failures ? 'FAILURES: ' + failures : 'ALL GREEN'));
  process.exit(failures ? 1 : 0);
})().catch((e) => { log('\nGATE ERROR: ' + e.message); process.exit(1); });
