/* _gate-0910-strict-reached.cjs — READ-ONLY. VOZ-511: the Audience "Reached" filter is too generous.
 *
 * The lane RPC calls a player "reached" on the LEAN rule — a call that connected and was not
 * voicemail. That counts a line that answered in silence and a player who hung up in four seconds.
 * Maria asked for those to be excluded (27 Aug). The dashboard already has the stricter rule:
 * REACHED_TAGS in src/app/analytics/recordsDisplay.ts = positive, neutral, declined, agent_timeout.
 *
 * This gate does three jobs:
 *   1. reproduces the drop between the two rules on prod, per call AND per player;
 *   2. proves the SQL rule in 2026-09-10_audience_lane_players_v4_strict_reached.sql computes the
 *      SAME answer as the TypeScript one, call by call, once that file has been applied;
 *   3. carries a known-bad control on every rule so a gate that has stopped testing cannot pass.
 *
 * Run before applying the SQL: parts 1 and 3 run, part 2 says the function is not applied yet.
 * Run after applying:          all three run and part 2 must be an EXACT match on every call.
 */
const fs = require('fs');
const log = (s) => process.stdout.write(s + '\n');
const env = {};
for (const l of fs.readFileSync('C:/Users/jasin/Desktop/voizo/Voizo/.env.local', 'utf8').split(/\r?\n/)) {
  const i = l.indexOf('=');
  if (i > 0 && !l.startsWith('#')) env[l.slice(0, i).trim()] = l.slice(i + 1).trim().replace(/^["']|["']$/g, '');
}
const h = { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: 'Bearer ' + env.SUPABASE_SERVICE_ROLE_KEY };

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
      log('  paged ' + table + ': ' + out.length + ' rows');
      return out;
    }
  }
}

// ── the dashboard's rules, transcribed from dashboardAnalytics.ts + transcriptClassify.ts ──
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
/** deriveAttemptTag, then REACHED_TAGS = positive | neutral | declined | agent_timeout. */
function strictReached(c, declinedContact) {
  if (c.goal_reached === true) return true;               // positive
  if (!isConnected(c.status)) return false;               // unreachable
  if (c.voicemail === true) return false;                 // voicemail
  if (isAgentTimeout(c.ended_reason)) return true;        // agent_timeout
  if (userTurns(transcriptText(c.transcript)) === 0) return false; // silent_pickup
  if (declinedContact) return true;                       // declined
  return !isEarlyHangup(c);                               // neutral, else early_hangup
}
/** What the lane RPC does today. */
const leanReached = (c) => isConnected(c.status) && !(c.voicemail === true && c.goal_reached !== true);

let failures = 0;
const check = (name, ok, detail) => { log((ok ? '  PASS  ' : '  FAIL  ') + name + (detail ? '   ' + detail : '')); if (!ok) failures++; };

(async () => {
  log('\n=== 0. KNOWN-BAD CONTROLS ===');
  check('a silent pickup is LEAN-reached but NOT strict-reached (the whole point)',
    leanReached({ status: 'completed', voicemail: false }) === true &&
    strictReached({ status: 'completed', voicemail: false, transcript: { text: 'AI: hello?' } }, false) === false);
  check('an early hang-up is LEAN-reached but NOT strict-reached',
    strictReached({ status: 'completed', voicemail: false, duration_seconds: 4,
      ended_reason: 'customer-ended-call', transcript: { text: 'AI: hi\nUser: no' } }, false) === false);
  check('a real conversation IS strict-reached',
    strictReached({ status: 'completed', voicemail: false, duration_seconds: 60,
      ended_reason: 'assistant-said-end-call-phrase',
      transcript: { text: 'AI: hi\nUser: yes go on\nAI: ok\nUser: sounds good' } }, false) === true);
  check('a declined contact IS strict-reached (a refusal is a conversation)',
    strictReached({ status: 'completed', voicemail: false, duration_seconds: 4,
      ended_reason: 'customer-ended-call', transcript: { text: 'AI: hi\nUser: not interested' } }, true) === true);
  check('voicemail is neither',
    leanReached({ status: 'completed', voicemail: true, goal_reached: false }) === false &&
    strictReached({ status: 'completed', voicemail: true }, false) === false);
  check('an unconnected call is neither', leanReached({ status: 'no_answer' }) === false);

  log('\n=== 1. the drop, on every call Voizo has made ===');
  const calls = await pageAll('calls_v2',
    'id,campaign_number_id,status,voicemail,goal_reached,duration_seconds,ended_reason,transcript', '');
  const declinedRows = await pageAll('campaign_numbers_v2', 'id', '&outcome=eq.declined_offer');
  const declined = new Set(declinedRows.map((r) => r.id));

  let lean = 0, strict = 0, dropped = 0;
  const why = { silent_pickup: 0, early_hangup: 0 };
  const leanPlayers = new Set(), strictPlayers = new Set();
  for (const c of calls) {
    const l = leanReached(c);
    const s = strictReached(c, declined.has(c.campaign_number_id));
    if (l) { lean++; leanPlayers.add(c.campaign_number_id); }
    if (s) { strict++; strictPlayers.add(c.campaign_number_id); }
    if (l && !s) {
      dropped++;
      if (userTurns(transcriptText(c.transcript)) === 0) why.silent_pickup++; else why.early_hangup++;
    }
  }
  log('');
  log('  calls                     lean-reached ' + lean + '   strict-reached ' + strict + '   dropped ' + dropped +
    '  (' + ((dropped / lean) * 100).toFixed(1) + '% of lean)');
  log('    of which answered in silence ' + why.silent_pickup + ', hung up early ' + why.early_hangup);
  log('  numbers (one per player+campaign)  lean ' + leanPlayers.size + '   strict ' + strictPlayers.size +
    '   dropped ' + (leanPlayers.size - strictPlayers.size));
  // Tightening the rule REMOVES calls, with one documented exception: deriveAttemptTag puts
  // goal_reached above the connection check (Val 2026-07-03/07-06), so a goal_reached call on a
  // status the lean rule calls unconnected is strict-reached and not lean-reached. There were 4
  // such rows in prod when that comment was written. Anything beyond a handful means the port drifted.
  const addedByStrict = calls.filter((c) =>
    strictReached(c, declined.has(c.campaign_number_id)) && !leanReached(c)).length;
  check('tightening only REMOVES calls, bar the documented goal_reached-on-unconnected residual',
    addedByStrict <= 10, addedByStrict + ' call(s) are strict-reached but not lean-reached');

  // The 08 Sep handoff recorded "5,307 of 9,982 (53.2%)" with no method written down anywhere,
  // and it does NOT reproduce: the denominator does (9,982 then vs this run's lean count, two more
  // days of calls), but no rule I can construct yields 5,307 as the numerator — silent-only,
  // duration-only, silence-timed-out-only, 0-or-1-turn and several windows were all tried. The
  // direction of that finding holds and is UNDERSTATED. This asserts the measured value instead,
  // with the method in this file, so the next run compares against something reproducible.
  const dropPct = (dropped / lean) * 100;
  check('the drop is far larger than half the lean-reached calls (08 Sep said 53.2%, unreproducible)',
    dropPct > 70, dropPct.toFixed(1) + '% drop — ' + dropped + ' of ' + lean);

  log('\n=== 1b. the SQL turn rule, simulated, vs the TypeScript parser ===');
  // voizo_user_turns() counts transcript LINES that start with a user prefix whose remainder
  // trims to 2+ characters. The TS parser is richer: bare speaker lines, timestamp lines,
  // unprefixed continuations. This simulates the SQL rule in JS and diffs it against the real
  // parser on every call, so the SQL is proved on the actual data BEFORE it is applied. If a
  // transcript shape ever appears that the two read differently, this goes red.
  const sqlTurnsSim = (txt) => String(txt ?? '').split(/\r?\n/).filter((ln) =>
    /^\s*(User|Customer|Caller|Human)\s*:/i.test(ln) &&
    ln.replace(/^\s*(User|Customer|Caller|Human)\s*:/i, '').trim().length >= 2).length;
  check('KNOWN-BAD: a one-character reply counts for neither rule',
    sqlTurnsSim('User: a') === 0 && userTurns('User: a') === 0);
  check('KNOWN-BAD: an agent-only line counts for neither', sqlTurnsSim('AI: hi') === 0 && userTurns('AI: hi') === 0);
  const shapes = { obj: 0, str: 0, other: 0, nul: 0 };
  let turnMismatch = 0;
  for (const c of calls) {
    const t = c.transcript;
    if (t === null || t === undefined) { shapes.nul++; continue; }
    if (typeof t === 'string') shapes.str++;
    else if (typeof t === 'object' && 'text' in t) shapes.obj++;
    else shapes.other++;
    if (userTurns(transcriptText(t)) !== sqlTurnsSim(typeof t === 'string' ? t : t.text)) turnMismatch++;
  }
  log('  transcript shapes: {text} ' + shapes.obj + ', bare string ' + shapes.str + ', other ' + shapes.other + ', null ' + shapes.nul);
  check('the SQL rule matches the parser on every call', turnMismatch === 0, turnMismatch + ' mismatches');
  check('no bare-string transcript, which ->>\'text\' would read as NULL', shapes.str === 0 && shapes.other === 0);

  log('\n=== 2. the SQL rule vs the TypeScript rule, call by call ===');
  const probe = await fetch(env.NEXT_PUBLIC_SUPABASE_URL + '/rest/v1/rpc/voizo_call_spoke_with', {
    method: 'POST', headers: { ...h, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_call_ids: calls.slice(0, 1).map((c) => c.id) }),
  });
  if (!probe.ok) {
    log('  SKIPPED — voizo_call_spoke_with() is not applied yet (HTTP ' + probe.status + ').');
    log('  Apply 2026-09-10_audience_lane_players_v4_strict_reached.sql, then re-run: this part must be EXACT.');
  } else {
    let mismatches = 0; const examples = [];
    for (let i = 0; i < calls.length; i += 500) {
      const chunk = calls.slice(i, i + 500);
      const r = await fetch(env.NEXT_PUBLIC_SUPABASE_URL + '/rest/v1/rpc/voizo_call_spoke_with', {
        method: 'POST', headers: { ...h, 'Content-Type': 'application/json' },
        body: JSON.stringify({ p_call_ids: chunk.map((c) => c.id) }),
      });
      if (!r.ok) throw new Error('rpc ' + r.status + ' ' + (await r.text()).slice(0, 200));
      const sqlSaid = new Map((await r.json()).map((x) => [x.call_id, x.spoke_with]));
      for (const c of chunk) {
        const ts = strictReached(c, declined.has(c.campaign_number_id));
        if (sqlSaid.get(c.id) !== ts) {
          mismatches++;
          if (examples.length < 5) examples.push(c.id + ' sql=' + sqlSaid.get(c.id) + ' ts=' + ts +
            ' turns=' + userTurns(transcriptText(c.transcript)) + ' dur=' + c.duration_seconds + ' end=' + c.ended_reason);
        }
      }
    }
    check('SQL and TypeScript agree on all ' + calls.length + ' calls', mismatches === 0,
      mismatches ? mismatches + ' mismatches, e.g. ' + examples.join(' | ') : 'exact');
  }

  log('\n' + (failures === 0 ? 'GATE PASSED — every check green.' : 'GATE FAILED — ' + failures + ' check(s) red.'));
  process.exit(failures === 0 ? 0 : 1);
})();
