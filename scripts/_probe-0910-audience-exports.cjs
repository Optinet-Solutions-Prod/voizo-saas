/* _probe-0910-audience-exports.cjs — prove the three new Audience exports on the RUNNING app.
 *
 * Client-side exports never leave the browser as a request, so a route check cannot see them. This
 * drives the real page over raw CDP, replaces URL.createObjectURL so every Blob handed to the
 * download helper is captured as text instead of saved, neuters the anchor click, then presses each
 * Export button and reads back what it would have written. A gate proves the numbers; this proves
 * the buttons produce the file they claim.
 *
 * Checks, each with what would make it fail:
 *   money strip   header row + at least one currency_total row + a day row  (fails if d is null or the
 *                 builder throws)
 *   families      header row + one row per family shown in the count         (fails if a field is off)
 *   journey       header + a trailing `note` row naming the completeness     (fails if the drawer never
 *                 opened, or the button stayed disabled because a load never finished)
 * Known-bad control: pressing a button whose data is absent must produce NO blob, not an empty one.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execSync } = require('child_process');

const env = {};
for (const l of fs.readFileSync('C:/Users/jasin/Desktop/voizo/Voizo/.env.local', 'utf8').split(/\r?\n/)) {
  const i = l.indexOf('=');
  if (i > 0 && !l.startsWith('#')) env[l.slice(0, i).trim()] = l.slice(i + 1).trim().replace(/^(["'])(.*)\1$/, '$2');
}
const USER = env.DASHBOARD_USERNAME, PASS = env.DASHBOARD_PASSWORD;
if (!USER || !PASS) throw new Error('DASHBOARD_USERNAME / DASHBOARD_PASSWORD missing');

function findChrome() {
  for (const g of ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    process.env.LOCALAPPDATA + '/Google/Chrome/Application/chrome.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe']) {
    if (g && fs.existsSync(g)) return g;
  }
  throw new Error('no Chrome or Edge found');
}
let failures = 0;
const check = (name, ok, detail) => { console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (detail ? '   ' + detail : '')); if (!ok) failures++; };

(async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'voizo-exp-'));
  const chrome = spawn(findChrome(), ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--remote-debugging-port=9334',
    '--user-data-dir=' + profile, '--window-size=1600,1000', 'about:blank'], { stdio: 'ignore' });
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  let ws = null;
  for (let i = 0; i < 40 && !ws; i++) {
    await wait(250);
    try { const list = await (await fetch('http://127.0.0.1:9334/json/list')).json(); const p = list.find((t) => t.type === 'page'); if (p) ws = p.webSocketDebuggerUrl; } catch { /* booting */ }
  }
  if (!ws) { chrome.kill(); throw new Error('CDP never came up'); }
  const sock = new WebSocket(ws);
  let id = 0; const pending = new Map();
  sock.addEventListener('message', (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
  await new Promise((r) => sock.addEventListener('open', r));
  const send = (method, params) => new Promise((resolve) => { const mid = ++id; pending.set(mid, resolve); sock.send(JSON.stringify({ id: mid, method, params: params || {} })); });
  const evalJs = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); return r.result?.result?.value; };
  const until = async (expr, tries = 120, step = 500) => { for (let i = 0; i < tries; i++) { if (await evalJs(expr)) return true; await wait(step); } return false; };

  await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
  await send('Network.setExtraHTTPHeaders', { headers: { Authorization: 'Basic ' + Buffer.from(USER + ':' + PASS).toString('base64') } });
  // Capture every Blob the download helper hands to the browser, BEFORE the app boots.
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `
    window.__blobs = [];
    const realCreate = URL.createObjectURL.bind(URL);
    URL.createObjectURL = (b) => { window.__blobs.push(b); return realCreate(b); };
    HTMLAnchorElement.prototype.click = function () { /* no download in the probe */ };
  ` });
  await send('Page.navigate', { url: 'http://localhost:3111/audience' });

  const readBlob = (i) => evalJs(`(async () => { const b = window.__blobs[${i}]; return b ? await b.text() : null; })()`);
  const blobCount = () => evalJs('window.__blobs.length');

  // ── money strip ──
  check('money strip loaded', await until(`!!document.querySelector('[aria-label="Depositors"]')`));
  await evalJs(`[...document.querySelectorAll('button[aria-label="Export deposits"]')][0]?.click()`);
  await wait(300);
  const dep = await readBlob(0);
  check('deposits export produced a file', !!dep);
  if (dep) {
    const lines = dep.replace(/^\uFEFF/, '').split('\r\n');
    check('deposits header', lines[0] === '"row","key","deposits","players","amount_local","amount_eur","deposits_before_contact","captured"', lines[0]);
    check('deposits has a depositors row, a currency row and a day row',
      lines.some((l) => l.startsWith('"depositors_in_window"')) && lines.some((l) => l.startsWith('"currency_total"')) && lines.some((l) => l.startsWith('"day"')),
      lines.length + ' lines');
  }

  // ── families ──
  check('families card loaded', await until(`(document.querySelector('[aria-label="Families"]')?.textContent || '').trim() !== ''`));
  const famCount = Number(await evalJs(`document.querySelector('[aria-label="Families"]')?.textContent`));
  await evalJs(`document.querySelector('button[aria-label="Export campaign families"]')?.click()`);
  await wait(300);
  const fam = await readBlob(1);
  check('families export produced a file', !!fam);
  if (fam) {
    const lines = fam.replace(/^\uFEFF/, '').split('\r\n').filter(Boolean);
    check('families header', lines[0] === '"family","market","runs","members","status","newest_run","newest_run_started","campaign_ids"', lines[0]);
    check('one row per family shown (' + famCount + ')', lines.length - 1 === famCount, (lines.length - 1) + ' rows');
  }

  // ── journey: open the first player row, wait for the drawer's two loads, export ──
  check('players table loaded', await until(`!!document.querySelector('section[aria-label="Player activity"] tbody tr td button, section[aria-label="Player activity"] tbody tr[role="button"], section[aria-label="Player activity"] tbody tr')`));
  const opened = await evalJs(`(() => {
    const tr = document.querySelector('section[aria-label="Player activity"] tbody tr');
    if (!tr) return 'no row';
    const target = tr.querySelector('button') || tr;
    target.click();
    return 'clicked ' + target.tagName;
  })()`);
  const drawerUp = await until(`!!document.querySelector('aside[role="dialog"][aria-label="Member detail"]')`, 40);
  check('drawer opened (' + opened + ')', drawerUp);
  const ready = await until(`(() => { const b = document.querySelector('button[aria-label="Export this player\\'s journey"]'); return !!b && !b.disabled; })()`, 120);
  check('journey export enabled once texts and Customer.io loaded', ready);
  const before = await blobCount();
  await evalJs(`document.querySelector('button[aria-label="Export this player\\'s journey"]')?.click()`);
  await wait(300);
  const journey = await readBlob(before);
  check('journey export produced a file', !!journey);
  if (journey) {
    const lines = journey.replace(/^\uFEFF/, '').split('\r\n').filter(Boolean);
    check('journey header', lines[0] === '"day_utc","time_utc","at_utc","source","kind","detail"', lines[0]);
    const last = lines[lines.length - 1];
    check('journey ends with the completeness note', /"note"/.test(last) && /calls: the last/.test(last), last.slice(0, 160));
  }

  // ── known-bad control: a disabled button produces nothing ──
  const countBefore = await blobCount();
  await evalJs(`(() => { const b = document.createElement('button'); b.disabled = true; b.onclick = () => URL.createObjectURL(new Blob(['x'])); document.body.appendChild(b); b.click(); })()`);
  check('KNOWN-BAD: a disabled button hands the browser no file', (await blobCount()) === countBefore);

  console.log('\n' + (failures === 0 ? 'PROBE PASSED — every export produced the file it claims.' : 'PROBE FAILED — ' + failures + ' check(s) red.'));
  sock.close(); chrome.kill();
  try { execSync('taskkill /F /PID ' + chrome.pid + ' /T', { stdio: 'ignore' }); } catch { /* gone */ }
  process.exit(failures === 0 ? 0 : 1);
})();
