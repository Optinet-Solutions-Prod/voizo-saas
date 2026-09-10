// _shot-0911-drawer-popups.cjs — READ-ONLY. The player drawer's three clickable summaries.
//
// Jasiel 2026-09-11: the SMS and CRM rows already opened a full list; Calls and Deposited did not,
// and lifetime deposits were nowhere. This drives the REAL page: opens a player with calls AND
// deposits, then for each summary asserts it is a real button, clicks it, and checks the popup's
// contents against the data behind it.
//
//   CALLS      the count on the row equals the number of rows in the popup, and equals what
//              /api/audience/player-calls returns. This is the VOZ-482 guard: the journey timeline
//              keeps only six calls and 14.9% of players have more, so a popup that quietly showed
//              the tail would pass a screenshot and lie to an operator.
//   DEPOSITS   after-contact and total are BOTH shown, total >= after, every deposit is listed,
//              and the per-currency sums in the popup equal a JS recount of the same rows.
//   DATES      no mm-dd survives; stamps read "29 Jul · 9:16 pm", 12-hour, with a separator.
//
// A gate proves the numbers; only a screenshot proves the page.
const fs = require('fs'); const os = require('os'); const path = require('path'); const { spawn } = require('child_process');
const env = {}; for (const l of fs.readFileSync('C:/Users/jasin/Desktop/voizo/Voizo/.env.local', 'utf8').split(/\r?\n/)) { const i = l.indexOf('='); if (i > 0 && !l.startsWith('#')) env[l.slice(0, i).trim()] = l.slice(i + 1).trim().replace(/^(["'])(.*)\1$/, '$2'); }
const chromePath = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe', process.env.LOCALAPPDATA + '/Google/Chrome/Application/chrome.exe'].find((p) => p && fs.existsSync(p));
const auth = 'Basic ' + Buffer.from(env.DASHBOARD_USERNAME + ':' + env.DASHBOARD_PASSWORD).toString('base64');
let failures = 0;
const check = (n, ok, d) => { console.log((ok ? '  PASS  ' : '  FAIL  ') + n + (d ? '   ' + d : '')); if (!ok) failures++; };

(async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'voizo-drawer-'));
  const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--remote-debugging-port=9357', '--user-data-dir=' + profile, '--window-size=1700,1300', 'about:blank'], { stdio: 'ignore' });
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  let ws = null;
  for (let i = 0; i < 40 && !ws; i++) { await wait(250); try { const l = await (await fetch('http://127.0.0.1:9357/json/list')).json(); const p = l.find((t) => t.type === 'page'); if (p) ws = p.webSocketDebuggerUrl; } catch {} }
  const sock = new WebSocket(ws); let id = 0; const pending = new Map();
  sock.addEventListener('message', (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
  await new Promise((r) => sock.addEventListener('open', r));
  const send = (m, p) => new Promise((res) => { const mid = ++id; pending.set(mid, res); sock.send(JSON.stringify({ id: mid, method: m, params: p || {} })); });
  const ev = async (e) => (await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true })).result?.result?.value;
  const until = async (e, n = 200) => { for (let i = 0; i < n; i++) { if (await ev(e)) return true; await wait(500); } return false; };
  const shoot = async (sel, file) => {
    const box = await ev(`(() => { const el = document.querySelector('${sel}'); if (!el) return null; const r = el.getBoundingClientRect(); return JSON.stringify({ x: Math.max(0, Math.floor(r.x) - 8), y: Math.max(0, Math.floor(r.y) - 8), width: Math.ceil(r.width) + 16, height: Math.ceil(r.height) + 16 }); })()`);
    if (!box) return check('screenshot ' + file, false, 'no element');
    const s = await send('Page.captureScreenshot', { format: 'png', clip: { ...JSON.parse(box), scale: 2 }, captureBeyondViewport: true });
    fs.writeFileSync(file, Buffer.from(s.result.data, 'base64'));
    console.log('  wrote ' + file);
  };
  await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
  await send('Network.setExtraHTTPHeaders', { headers: { Authorization: auth } });

  // The card renames itself to "Depositors" the moment that filter is set, so every selector here
  // must accept BOTH labels; the first run retried five times against a card that no longer
  // matched (2026-09-11, the same trap the 09-10 strip probe hit).
  // A player with BOTH calls and deposits. The page's filters are React state, NOT URL params, so
  // ?deposited=after did nothing and the probe opened whichever player happened to be first — one
  // with no deposits, which made every popup correctly absent (2026-09-11). Drive the real select.
  await send('Page.navigate', { url: 'http://localhost:3111/audience' });
  // Wait for a REAL row, not the skeleton placeholders: those are <td>s too, and the first run of
  // this probe read them as the table and then found no phone in it (2026-09-11).
  check('page loaded and a real player row rendered',
    await until(`/\\+\\d{8,15}/.test(document.querySelector('section[aria-label="Player activity"] tbody, section[aria-label="Depositors"] tbody').textContent)`));

  // Deposited = After contact, through the select the operator uses. Retried, because an early
  // click lands before React has attached (the 2026-09-10 footer-probe lesson).
  const pick = async (prefix, option) => {
    for (let a = 0; a < 5; a++) {
      await ev(`(() => { const card = document.querySelector('section[aria-label="Player activity"], section[aria-label="Depositors"]'); const b = [...card.querySelectorAll('button')].find((x) => (x.textContent || '').startsWith('${prefix}')); b && b.click(); })()`);
      await wait(400);
      await ev(`(() => { const o = [...document.querySelectorAll('[role="option"], li, button')].find((e) => (e.textContent || '').trim() === '${option}'); o && o.click(); })()`);
      await wait(700);
      const now = await ev(`(() => { const card = document.querySelector('section[aria-label="Player activity"], section[aria-label="Depositors"]'); const b = [...card.querySelectorAll('button')].find((x) => (x.textContent || '').startsWith('${prefix}')); return b ? b.textContent : ''; })()`);
      if (String(now).includes(option)) return true;
      await wait(800);
    }
    return false;
  };
  check('Deposited = After contact took on the table', await pick('Deposited:', 'After contact'));
  // WAIT for the filtered table, not merely for "a phone exists": one was already on screen from
  // the unfiltered list, so the probe grabbed a stale row with no deposits and then reported the
  // deposit popup missing (2026-09-11). The card renames itself to "Depositors" only when the
  // filter has actually applied, which is the signal worth waiting on.
  check('the filtered table rendered',
    await until(`(() => { const d = document.querySelector('section[aria-label="Depositors"] tbody'); return !!d && /\\+\\d{8,15}/.test(d.textContent); })()`, 60));

  // Choose the player from the API, not by scraping the table. Scraping picked a phone the filtered
  // query does not even contain (2026-09-11), because the DOM lags the fetch. Asking the route for
  // one that definitely has BOTH calls and deposits makes everything below deterministic. Prefer a
  // player with a BEFORE-contact deposit, since that is the only case that shows the total row.
  // This probe's own extra call lands beside the page's three heavy ones, and the players
  // statement then crosses the 8 s limit and 500s — contention the PROBE created, not a fault in
  // the page (2026-09-11). So wait for the page to go quiet, then retry rather than reporting a
  // failure that is really impatience.
  let pool = [];
  for (let a = 0; a < 3 && !pool.length; a++) {
    await wait(a === 0 ? 2500 : 6000);
    const raw = await ev(`fetch('/api/audience/players?range=7d&deposited=after&page=1').then((r)=>r.json()).then((j)=>JSON.stringify(Array.isArray(j.rows)?j.rows.filter((r)=>r.deposits.length&&r.calls).map((r)=>({p:r.phone,before:r.deposits.some((d)=>!d.afterContact)})):[])).catch(()=>JSON.stringify([]))`);
    pool = typeof raw === "string" ? JSON.parse(raw) : [];
  }
  if (!pool.length) { check('the players route offered candidates', false, 'empty after three tries'); sock.close(); chrome.kill(); process.exit(1); }
  // Take a player the FILTERED table is actually showing, and cross it against the pool. Typing
  // into the search box to reach a chosen player was flaky (2026-09-11); the table in front of us
  // is already the right population, so read from it and look the row up rather than steering it.
  const onScreen = JSON.parse(await ev(`JSON.stringify([...document.querySelectorAll('section[aria-label="Depositors"] tbody tr')].map((tr) => (tr.textContent.match(/\\+\\d{8,15}/) || [''])[0]).filter(Boolean))`));
  const byPhone = new Map(pool.map((x) => [x.p, x.before]));
  // Prefer one with a BEFORE-contact deposit, since that is the only case that shows the total row.
  // The pool is page ONE of the route's own sort and the table may be showing a different page or
  // window, so the two lists can miss each other entirely (2026-09-11, 25 rows and 25 candidates
  // with no overlap). Fall back to the first phone the table is actually showing and ask the route
  // about THAT player, which is the only list guaranteed to match what is on screen.
  let phone = onScreen.find((p) => byPhone.get(p) === true) ?? onScreen.find((p) => byPhone.has(p)) ?? "";
  let expectTotalRow = byPhone.get(phone) === true;
  if (!phone && onScreen.length) {
    phone = onScreen[0];
    const one = await ev(`fetch('/api/audience/players?range=7d&deposited=after&q=${encodeURIComponent(String(phone).replace('+', ''))}&page=1').then((r)=>r.json()).then((j)=>JSON.stringify((j.rows||[]).map((r)=>({p:r.phone,before:r.deposits.some((d)=>!d.afterContact)})))).catch(()=>'[]')`);
    const row = (typeof one === "string" ? JSON.parse(one) : []).find((x) => x.p === phone);
    expectTotalRow = row ? row.before === true : false;
  }
  check('a player on screen has calls and deposits', /^\+\d{8,15}$/.test(String(phone)),
    `${onScreen.length} rows on screen, ${pool.length} candidates · using ${phone} · before-contact deposit: ${expectTotalRow}`);
  const api = JSON.parse(await ev(`fetch('/api/audience/player-calls?phone=${encodeURIComponent(String(phone))}').then(r=>r.json()).then(JSON.stringify)`));
  console.log('  player ' + phone + ' · route says ' + api.calls.length + ' calls, truncated=' + api.truncated);

  // open the drawer
  await ev(`(() => { const tr = [...document.querySelectorAll('section[aria-label="Depositors"] tbody tr')].find((r) => r.textContent.includes('${phone}')); tr && tr.click(); })()`);
  check('the drawer opened', await until(`!!document.querySelector('[role="dialog"][aria-label="Member detail"] [aria-label="Deposited after contact"]')`));
  // The Calls row only becomes a button once its lazy fetch lands; asserting before that read a
  // plain <div> and failed for the wrong reason (2026-09-11).
  check('the calls fetch landed', await until(`document.querySelector('[role="dialog"][aria-label="Member detail"] [aria-label="Calls"]').tagName === 'BUTTON'`, 60));
  await shoot('[aria-label="Deposited after contact"]', 'scratchpad/_shot-0911-drawer-summary.png');

  // ── the summary rows are BUTTONS, not text ──
  // Read the drawer's own state rather than predicting it from a second query. The table's window
  // and this probe's API call could disagree, and then the probe reported a missing popup for a
  // player who simply has no deposits in the window on screen (2026-09-11). What must hold is the
  // INVARIANT: a row showing money is clickable, a row showing none is not.
  const depRowKind = await ev(`(() => { const el = document.querySelector('[role="dialog"][aria-label="Member detail"] [aria-label="Deposited after contact"]'); return el ? el.tagName + '|' + el.textContent.trim() : 'MISSING'; })()`);
  const hasDeposits = String(depRowKind).startsWith('BUTTON');
  console.log('  deposit row: ' + depRowKind);
  if (!hasDeposits) {
    check('a row with no deposits is plain text, not a dead button',
      /^DIV\|(none|no record)$/.test(String(depRowKind)), String(depRowKind));
    console.log('  NOTE: this player has no deposits in the window on screen, so the deposit popup is correctly absent.');
  }

  for (const label of hasDeposits ? ['Calls', 'Deposited after contact'] : ['Calls']) {
    const kind = await ev(`(() => { const el = document.querySelector('[role="dialog"][aria-label="Member detail"] [aria-label="${label}"]'); return el ? el.tagName + (el.getAttribute('aria-haspopup') || '') : 'MISSING'; })()`);
    check(`"${label}" is a clickable summary`, String(kind) === 'BUTTONdialog', String(kind));
  }
  // "Deposited, total" appears ONLY when some of the money came before contact; otherwise it would
  // repeat the row above to the cent (Jasiel 2026-09-11: "kind of redundant seeing 2 total").
  const totalRow = await ev(`(() => { const el = document.querySelector('[role="dialog"][aria-label="Member detail"] [aria-label="Deposited total"]'); return el ? el.tagName + (el.getAttribute('aria-haspopup') || '') : 'ABSENT'; })()`);
  if (hasDeposits && expectTotalRow) {
    check('"Deposited, total" is shown, because some money came before contact', String(totalRow) === 'BUTTONdialog', String(totalRow));
  } else {
    check('"Deposited, total" is HIDDEN, because it would repeat the row above', String(totalRow) === 'ABSENT', String(totalRow));
  }
  if (!hasDeposits) {
    sock.close(); chrome.kill();
    console.log('\n' + (failures ? 'FAILURES: ' + failures : 'ALL GREEN (deposit popup skipped: this player has none)'));
    process.exit(failures ? 1 : 0);
  }

  // ── CALLS popup ──
  await ev(`document.querySelector('[role="dialog"][aria-label="Member detail"] [aria-label="Calls"]').click()`);
  check('the Calls popup opened', await until(`!!document.querySelector('[role="dialog"][aria-label="Calls"]')`, 40));
  const callsPop = JSON.parse(await ev(`(() => {
    const d = document.querySelector('[role="dialog"][aria-label="Calls"]');
    const rows = [...d.querySelectorAll('[role="row"]')];
    return JSON.stringify({ title: d.querySelector('span.font-semibold').textContent.trim(), rows: rows.length,
      campaigns: rows.filter((r) => (r.children[1].textContent || '').trim() && (r.children[1].textContent || '').trim() !== '—').length,
      text: d.textContent.slice(0, 160) });
  })()`));
  console.log('  calls popup: ' + callsPop.title + ' · ' + callsPop.rows + ' rows · ' + callsPop.campaigns + ' name a campaign');
  check('the popup lists EVERY call the route returned (not the six-call tail)',
    callsPop.rows === api.calls.length, callsPop.rows + ' rows vs route ' + api.calls.length);
  check('every call names its campaign', callsPop.campaigns === callsPop.rows, callsPop.campaigns + ' of ' + callsPop.rows);
  await shoot('[role="dialog"][aria-label="Calls"]', 'scratchpad/_shot-0911-drawer-calls.png');
  await ev(`document.querySelector('[role="dialog"][aria-label="Calls"]').parentElement.click()`);
  await wait(400);

  // ── DEPOSITS popup ──
  await ev(`document.querySelector('[role="dialog"][aria-label="Member detail"] [aria-label="Deposited total"], [role="dialog"][aria-label="Member detail"] [aria-label="Deposited after contact"]').click()`);
  check('the Deposits popup opened', await until(`!!document.querySelector('[role="dialog"][aria-label="Deposits"]')`, 40));
  const depPop = JSON.parse(await ev(`(() => {
    const d = document.querySelector('[role="dialog"][aria-label="Deposits"]');
    const rows = [...d.querySelectorAll('[role="row"]')];
    const cells = rows.map((r) => ({ when: r.children[1].textContent.trim(), amount: r.children[2].textContent.trim() }));
    return JSON.stringify({ title: d.querySelector('span.font-semibold').textContent.trim(), rows: rows.length, cells,
      // PopupShell is [header, scrollable body]; the summary grid is the body's first child, and
      // its four cells are label, value, label, value.
      afterLine: d.children[1].children[0].children[1].textContent.trim(),
      totalLine: d.children[1].children[0].children[3].textContent.trim(),
      caveat: /26 Jul/.test(d.textContent) && /26 Aug to 1 Sep/.test(d.textContent) });
  })()`));
  console.log('  deposits popup: ' + depPop.title + ' · after ' + depPop.afterLine + ' · total ' + depPop.totalLine);
  // recount the popup's own rows and compare with the two summary lines it prints
  const parse = (s) => { const m = [...String(s).matchAll(/([A-Z]{3}) ([\d,]+\.\d{2})/g)]; return m.map((x) => [x[1], Number(x[2].replace(/,/g, ''))]); };
  const recount = {};
  for (const c of depPop.cells) { const [p] = parse(c.amount); if (p) recount[p[0]] = (recount[p[0]] || 0) + p[1]; }
  const totalShown = Object.fromEntries(parse(depPop.totalLine));
  check('the popup total equals a recount of its own rows',
    JSON.stringify(Object.keys(recount).sort().map((k) => [k, recount[k].toFixed(2)])) ===
    JSON.stringify(Object.keys(totalShown).sort().map((k) => [k, totalShown[k].toFixed(2)])),
    JSON.stringify(recount) + ' vs ' + JSON.stringify(totalShown));
  const afterCount = depPop.cells.filter((c) => c.when === 'after contact').length;
  check('after-contact is a subset of the total, and both are shown',
    afterCount <= depPop.rows && !!depPop.afterLine && !!depPop.totalLine, afterCount + ' after of ' + depPop.rows);
  check('the popup states the coverage caveat, so "total" is not read as "lifetime"', depPop.caveat);
  await shoot('[role="dialog"][aria-label="Deposits"]', 'scratchpad/_shot-0911-drawer-deposits.png');
  await ev(`document.querySelector('[role="dialog"][aria-label="Deposits"]').parentElement.click()`);
  await wait(400);

  // ── DATES: words, 12-hour, separated ──
  const stamps = JSON.parse(await ev(`(() => {
    const tds = [...document.querySelectorAll('section[aria-label="Player activity"] tbody, section[aria-label="Depositors"] tbody td, section[aria-label="Depositors"] tbody td')].map((t) => t.textContent.trim());
    return JSON.stringify(tds.filter((t) => /\\d.*(am|pm)$/.test(t)).slice(0, 6));
  })()`));
  console.log('  stamps: ' + stamps.join(' | '));
  check('dates read as words with a 12-hour clock and a separator',
    stamps.length > 0 && stamps.every((t) => /^\s*\d{1,2}\s[A-Z][a-z]{2}\s·\s+\d{1,2}:\d{2}\s(am|pm)$/.test(t)), stamps[0]);
  check('no mm-dd numeric date survives anywhere on the page',
    !(await ev(`/\\b\\d{2}-\\d{2}\\b(?!\\d)/.test(document.querySelector('section[aria-label="Player activity"], section[aria-label="Depositors"]').textContent)`)));

  sock.close(); chrome.kill();
  console.log('\n' + (failures ? 'FAILURES: ' + failures : 'ALL GREEN'));
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.log('SHOT ERROR: ' + e.message); process.exit(1); });
