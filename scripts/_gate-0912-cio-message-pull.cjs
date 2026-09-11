/* _gate-0912-cio-message-pull.cjs — VOZ-479's proof. Run AFTER pasting
 * supabase-migration-cio-message-pull.sql, with the dev server up on 3111.
 *
 * Proves, in this order, and fails loudly on the first thing that is not true:
 *
 *   P  PRECONDITION, with a known-bad control. PostgREST returns NO error for `head: true` on a
 *      MISSING table, so a migration check written the obvious way passes blind. Every existence
 *      probe here is paired with a table that cannot exist; if the control does not error, the
 *      probe proved nothing and the gate says so instead of going green.
 *   D  DRY RUN writes nothing. The row count before and after must be identical.
 *   R  REAL RUN writes rows, and the route's own counters agree with the table.
 *   A  AGREEMENT: for every account touched, the API is called again independently in the same
 *      window and the stored message ids must match what the API returns.
 *   T  TIMESTAMPS re-derived from the STORED metrics must equal the stored columns, and a stored
 *      row whose metrics has no `sent` must have sent_at NULL. That is the design's known-bad
 *      control (§7), asserted against real rows rather than a fixture.
 *   PR PRIVACY: the recipient addresses the API just handed us must appear NOWHERE in our table,
 *      and the column set must carry no recipient / customer_identifiers.
 *
 * Usage: node scripts/_gate-0912-cio-message-pull.cjs [maxAccounts]
 */
const fs = require('fs');
const log = (s) => process.stdout.write(s + '\n');
const env = {};
for (const l of fs.readFileSync('C:/Users/jasin/Desktop/voizo/Voizo/.env.local', 'utf8').split(/\r?\n/)) {
  const i = l.indexOf('=');
  if (i > 0 && !l.startsWith('#')) env[l.slice(0, i).trim()] = l.slice(i + 1).trim().replace(/^["']|["']$/g, '');
}
const SB = env.NEXT_PUBLIC_SUPABASE_URL;
const h = { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: 'Bearer ' + env.SUPABASE_SERVICE_ROLE_KEY };
const API = 'https://api-eu.customer.io';
const BASE = 'http://localhost:3111';
const MAX = Number(process.argv[2] || 6);

let failures = 0;
const ok = (label, pass, detail = '') => {
  log(`  ${pass ? 'PASS' : '*** FAIL'}  ${label}${detail ? '  — ' + detail : ''}`);
  if (!pass) failures++;
  return pass;
};

function resolveAppApiKey(ws) {
  let map = {};
  try { map = JSON.parse(env.CUSTOMERIO_APP_API_KEYS || '{}'); } catch { map = {}; }
  if (typeof map[ws] === 'string' && map[ws].trim()) return map[ws].trim();
  if (ws === 'lucky7even' && env.CUSTOMERIO_APP_API_KEY) return env.CUSTOMERIO_APP_API_KEY;
  return null;
}

async function sb(path, extra = {}) {
  // `{ headers: {...}, ...extra }` puts extra.headers LAST and silently drops the apikey and
  // Authorization, so every call with custom headers 401s. That is not hypothetical: it made
  // count() return null on both sides of the dry run, and null === null passed as "unchanged"
  // (2026-09-12). Spread extra FIRST, then build headers on top so auth always survives.
  const r = await fetch(`${SB}/rest/v1/${path}`, { ...extra, headers: { ...h, ...extra.headers } });
  const text = await r.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return { status: r.status, ok: r.ok, body, range: r.headers.get('content-range') };
}
/** Exact row count, or null when the request failed. Callers must treat null as a FAILURE and
 *  never as a value to compare — see the self-test below. */
const count = async (table) => {
  const r = await sb(`${table}?select=*`, { headers: { Range: '0-0', 'Range-Unit': 'items', Prefer: 'count=exact' } });
  if (!r.ok) return null;
  const n = Number(String(r.range || '').split('/')[1]);
  return Number.isFinite(n) ? n : null;
};

(async () => {
  log('=== P. preconditions (each paired with a known-bad control) ===');
  const IMPOSSIBLE = 'table_that_cannot_exist_0912';
  const control = await sb(`${IMPOSSIBLE}?select=*&limit=1`);
  if (!ok('the control table errors, so an existence probe means something', !control.ok,
          `HTTP ${control.status}`)) {
    log('\n  The control did not fail. Every check below would be meaningless. Stopping.');
    process.exit(1);
  }
  let missing = false;
  for (const t of ['cio_messages', 'cio_delivery_sync']) {
    const r = await sb(`${t}?select=*&limit=1`);
    if (!ok(`${t} exists`, r.ok, r.ok ? '' : `HTTP ${r.status} ${JSON.stringify(r.body).slice(0, 120)}`)) missing = true;
  }
  const rpc = await fetch(`${SB}/rest/v1/rpc/cio_pull_queue`, {
    method: 'POST', headers: { ...h, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_days: 30, p_limit: 3 }),
  });
  const rpcBody = await rpc.json().catch(() => null);
  if (!ok('cio_pull_queue() exists and returns rows', rpc.ok && Array.isArray(rpcBody) && rpcBody.length > 0,
          rpc.ok ? `${(rpcBody || []).length} rows` : `HTTP ${rpc.status}`)) missing = true;

  if (missing) {
    log('\n  Paste supabase-migration-cio-message-pull.sql first. Nothing below can run.');
    process.exit(1);
  }

  log('\n=== D. dry run writes nothing ===');
  // SELF-TEST THE COUNTER FIRST. A broken count() returns null on both sides of the dry run and
  // `null === null` reads as "unchanged" — the check passes precisely when it is measuring
  // nothing. cio_events is a table that exists and is known non-empty, so a finite positive count
  // here is what earns the right to believe the two comparisons below.
  const counterWorks = await count('cio_events');
  if (!ok('count() works at all (control: cio_events is known non-empty)',
          Number.isFinite(counterWorks) && counterWorks > 0, `cio_events = ${counterWorks}`)) {
    log('\n  The counter is broken, so "row count unchanged" would pass while measuring nothing. Stopping.');
    process.exit(1);
  }

  const before = await count('cio_messages');
  const beforeSync = await count('cio_delivery_sync');
  ok('both baseline counts are real numbers, not nulls',
     Number.isFinite(before) && Number.isFinite(beforeSync), `cio_messages=${before} cio_delivery_sync=${beforeSync}`);
  const dry = await fetch(`${BASE}/api/cron/cio-message-pull?dry=1&max=${MAX}`, {
    headers: { Authorization: `Bearer ${env.CRON_SECRET}` },
  });
  const dryBody = await dry.json();
  ok('dry run answered 200', dry.status === 200, JSON.stringify(dryBody.counts || dryBody).slice(0, 200));
  ok('dry run reports messages it WOULD write', (dryBody.counts?.messages ?? 0) > 0, `${dryBody.counts?.messages} messages`);
  const afterDry = await count('cio_messages');
  const afterDrySync = await count('cio_delivery_sync');
  ok('cio_messages row count unchanged',
     Number.isFinite(afterDry) && Number.isFinite(before) && afterDry === before, `${before} -> ${afterDry}`);
  ok('cio_delivery_sync row count unchanged',
     Number.isFinite(afterDrySync) && Number.isFinite(beforeSync) && afterDrySync === beforeSync, `${beforeSync} -> ${afterDrySync}`);

  log('\n=== R. real run ===');
  const runStart = new Date().toISOString();
  const real = await fetch(`${BASE}/api/cron/cio-message-pull?max=${MAX}`, {
    headers: { Authorization: `Bearer ${env.CRON_SECRET}` },
  });
  const body = await real.json();
  ok('real run answered 200', real.status === 200, JSON.stringify(body.errors || []).slice(0, 200));
  ok('no errors reported', (body.errors || []).length === 0, JSON.stringify(body.errors || []));
  ok('every configured workspace was reachable', (body.workspaces?.stoppedByRateLimit || []).length === 0);
  log(`     counts: ${JSON.stringify(body.counts)}`);
  log(`     workspaces: ${JSON.stringify(body.workspaces)}`);

  const touched = await sb(`cio_delivery_sync?select=workspace,cio_id,last_message_at,last_error&last_pulled_at=gte.${runStart}`);
  ok('the sync table records the accounts just pulled', touched.ok && touched.body.length > 0, `${touched.body?.length} accounts`);

  const written = await sb(`cio_messages?select=*&pulled_at=gte.${runStart}&limit=1000`);
  ok('rows were written', written.ok && written.body.length > 0, `${written.body?.length} rows`);
  ok('route counter matches rows actually in the table',
     written.body.length === body.counts.upserted,
     `table ${written.body.length} vs reported ${body.counts.upserted}`);

  log('\n=== A. agreement with the API, asked again independently ===');
  const now = Math.floor(Date.now() / 1000);
  for (const acct of (touched.body || []).filter((a) => !a.last_error).slice(0, 3)) {
    const key = resolveAppApiKey(acct.workspace);
    if (!key) { ok(`${acct.workspace} key present`, false); continue; }
    const mine = (written.body || []).filter((r) => r.workspace === acct.workspace && r.cio_id === acct.cio_id);
    // Widest window the route could have used, so the API set is a superset of ours, never smaller.
    const r = await fetch(`${API}/v1/customers/${acct.cio_id}/messages?id_type=cio_id&limit=100&start_ts=${now - 400 * 86400}&end_ts=${now}`,
      { headers: { Authorization: 'Bearer ' + key } });
    const apiMsgs = r.ok ? ((await r.json()).messages || []) : [];
    const apiIds = new Set(apiMsgs.map((m) => m.id));
    const orphans = mine.filter((m) => !apiIds.has(m.message_id));
    ok(`${acct.workspace}/${String(acct.cio_id).slice(0, 8)}: every stored id is one the API returns`,
       orphans.length === 0, `${mine.length} stored, ${apiIds.size} from API, ${orphans.length} orphaned`);
  }

  log('\n=== T. timestamps re-derived from the STORED metrics ===');
  const rows = written.body || [];
  const MIN_EPOCH = 946684800;
  let mismatched = 0, noSentRows = 0, noSentWrong = 0, outOfRange = 0;
  for (const row of rows) {
    for (const [metric, column] of [['sent', 'sent_at'], ['delivered', 'delivered_at'], ['opened', 'opened_at'],
                                    ['clicked', 'clicked_at'], ['converted', 'converted_at'], ['failed', 'failed_at']]) {
      const raw = row.metrics ? row.metrics[metric] : undefined;
      const stored = row[column];
      if (raw === undefined) {
        if (stored !== null) { mismatched++; }              // a column with no metric behind it
        if (metric === 'sent') { noSentRows++; if (stored !== null) noSentWrong++; }
        continue;
      }
      const n = Number(raw);
      if (!Number.isFinite(n) || n < MIN_EPOCH || n > now + 366 * 86400) { outOfRange++; continue; }
      // Compare INSTANTS. Postgres renders timestamptz as "2026-09-11T00:01:46+00:00" and JS
      // toISOString() as "2026-09-11T00:01:46.000Z" — the same moment, never the same string.
      // String equality here reported 226 mismatches on 140 perfectly correct rows (2026-09-12).
      if (Date.parse(stored) !== n * 1000) mismatched++;
    }
  }
  ok('every derived column equals its own metric, re-derived from the stored map', mismatched === 0, `${mismatched} mismatches over ${rows.length} rows`);
  // THE KNOWN-BAD CONTROL, on real rows: no `sent` in the map must mean sent_at IS NULL.
  // THE DESIGN'S NAMED KNOWN-BAD CONTROL (§7), over the WHOLE table rather than this run's sample.
  // Scoped to one run it depended on which accounts the queue happened to hand back: one run found
  // 2 such rows and the next found none and printed "control not exercised", which is a control
  // that only sometimes controls. 11 of 526 probed messages carry no `metrics.sent`, so at table
  // scale there is always something to test.
  const everything = await sb('cio_messages?select=message_id,sent_at,metrics&limit=1000');
  const noSentAll = (everything.body || []).filter((r) => !r.metrics || r.metrics.sent === undefined);
  const wrongAll = noSentAll.filter((r) => r.sent_at !== null);
  ok('a stored row with no metrics.sent has sent_at NULL (whole table)',
     noSentAll.length > 0 && wrongAll.length === 0,
     noSentAll.length === 0
       ? `NO SUCH ROW IN ${(everything.body || []).length} — the control cannot run, so this proves nothing`
       : `${noSentAll.length} such rows of ${(everything.body || []).length}, ${wrongAll.length} wrongly dated`);
  // And the mirror: a row that DOES carry `sent` must have a sent_at, or the guard is rejecting
  // everything rather than only the bad values.
  const withSent = (everything.body || []).filter((r) => r.metrics && r.metrics.sent !== undefined);
  ok('a stored row WITH metrics.sent has a sent_at (the guard rejects the bad, not the good)',
     withSent.length > 0 && withSent.every((r) => r.sent_at !== null),
     `${withSent.filter((r) => r.sent_at === null).length} of ${withSent.length} wrongly null`);
  ok('no stored timestamp came from an out-of-range metric', outOfRange === 0, `${outOfRange}`);

  log('\n=== PR. privacy ===');
  const cols = new Set(Object.keys(rows[0] || {}));
  ok('no `recipient` column', !cols.has('recipient'));
  ok('no `customer_identifiers` column', !cols.has('customer_identifiers'));
  ok('no `customer_id` column', !cols.has('customer_id'));
  // The strongest form: take the addresses the API just handed us and prove none of them is in
  // our table anywhere.
  // CAREFUL: for an `in_app` message Customer.io sets `recipient` to the cio_id ITSELF (32 of 33
  // on one probed account, 2026-09-12). We store cio_id on purpose — it is the join key — so a
  // naive "does any recipient string appear in our rows" test reports a leak on every in_app
  // message. Exclude a recipient that is its own account's cio_id; everything else — email
  // addresses, webhook URLs, phone numbers — is genuinely forbidden and still tested.
  const recipients = new Set();
  let selfIds = 0;
  for (const acct of (touched.body || []).filter((a) => !a.last_error).slice(0, 3)) {
    const key = resolveAppApiKey(acct.workspace);
    if (!key) continue;
    const r = await fetch(`${API}/v1/customers/${acct.cio_id}/messages?id_type=cio_id&limit=100&start_ts=${now - 400 * 86400}&end_ts=${now}`,
      { headers: { Authorization: 'Bearer ' + key } });
    if (!r.ok) continue;
    for (const m of ((await r.json()).messages || [])) {
      if (typeof m.recipient !== 'string' || !m.recipient) continue;
      if (m.recipient === acct.cio_id) { selfIds++; continue; }
      recipients.add(m.recipient);
    }
  }
  log(`     (${selfIds} in_app recipients are the cio_id itself and are excluded by design)`);
  const haystack = JSON.stringify(rows);
  const leaked = [...recipients].filter((addr) => haystack.includes(addr));
  ok(`none of the ${recipients.size} real recipient values the API returned appears in our rows`,
     leaked.length === 0, leaked.length ? `LEAKED ${leaked.length}` : '');
  // A control for the control: the test above only means something if a string we DID store would
  // be found. Prove the search works by looking for one.
  ok('the leak search can actually find a string that IS in our rows (control)',
     haystack.includes(rows[0].message_id), 'searched for a stored message_id');
  ok('metrics holds numbers only',
     rows.every((r) => Object.values(r.metrics || {}).every((v) => typeof v === 'number')));

  log(`\n${failures === 0 ? '=== ALL GREEN ===' : `=== ${failures} FAILURE(S) ===`}`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { log('FATAL ' + e.message); process.exit(1); });
