// _shot-0910-strip-follows-filters.cjs — prove on the RUNNING page that the money strip follows the
// Depositors table's filters: pick Contact = Spoke with them, read the strip, and screenshot it.
// A gate proves the numbers; only a screenshot proves the page.
const fs = require('fs'); const os = require('os'); const path = require('path'); const { spawn, execSync } = require('child_process');
const env = {}; for (const l of fs.readFileSync('C:/Users/jasin/Desktop/voizo/Voizo/.env.local', 'utf8').split(/\r?\n/)) { const i = l.indexOf('='); if (i > 0 && !l.startsWith('#')) env[l.slice(0, i).trim()] = l.slice(i + 1).trim().replace(/^(["'])(.*)\1$/, '$2'); }
const chromePath = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe', process.env.LOCALAPPDATA + '/Google/Chrome/Application/chrome.exe'].find((p) => p && fs.existsSync(p));
let failures = 0;
const check = (name, ok, detail) => { console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (detail ? '   ' + detail : '')); if (!ok) failures++; };
(async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'voizo-strip-'));
  const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--remote-debugging-port=9336', '--user-data-dir=' + profile, '--window-size=1700,1000', 'about:blank'], { stdio: 'ignore' });
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  let ws = null; for (let i = 0; i < 40 && !ws; i++) { await wait(250); try { const l = await (await fetch('http://127.0.0.1:9336/json/list')).json(); const p = l.find((t) => t.type === 'page'); if (p) ws = p.webSocketDebuggerUrl; } catch {} }
  const sock = new WebSocket(ws); let id = 0; const pending = new Map();
  sock.addEventListener('message', (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
  await new Promise((r) => sock.addEventListener('open', r));
  const send = (method, params) => new Promise((res) => { const mid = ++id; pending.set(mid, res); sock.send(JSON.stringify({ id: mid, method, params: params || {} })); });
  const evalJs = async (e) => (await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true })).result?.result?.value;
  const until = async (e, n = 120) => { for (let i = 0; i < n; i++) { if (await evalJs(e)) return true; await wait(500); } return false; };
  await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
  await send('Network.setExtraHTTPHeaders', { headers: { Authorization: 'Basic ' + Buffer.from(env.DASHBOARD_USERNAME + ':' + env.DASHBOARD_PASSWORD).toString('base64') } });
  await send('Page.navigate', { url: 'http://localhost:3111/audience' });
  check('page loaded and hydrated', await until(`!!document.querySelector('div[aria-label="Depositors"]') && !!document.querySelector('section[aria-label="Player activity"] tbody tr td')`));

  const readStrip = () => evalJs(`(() => {
    const dep = document.querySelector('div[aria-label="Depositors"]')?.textContent || '';
    const gross = document.querySelector('div[aria-label="Gross"]')?.textContent || '';
    const eur = (gross.match(/EUR [0-9,]+ normalised/) || [''])[0];
    return { depositors: dep.trim(), eur };
  })()`);
  const before = await readStrip();
  console.log('strip, no filter:   ' + JSON.stringify(before));

  const pick = async (prefix, optionText) => {
    for (let attempt = 0; attempt < 5; attempt++) {
      await evalJs(`(() => { const card = document.querySelector('section[aria-label="Player activity"], section[aria-label="Depositors"]'); const b = [...card.querySelectorAll('button')].find((x) => (x.textContent || '').startsWith('${prefix}')); b && b.click(); })()`);
      await wait(400);
      await evalJs(`(() => { const o = [...document.querySelectorAll('[role="option"], li, button')].find((e) => (e.textContent || '').trim() === '${optionText}'); o && o.click(); })()`);
      await wait(600);
      const now = await evalJs(`(() => { const card = document.querySelector('section[aria-label="Player activity"], section[aria-label="Depositors"]'); const b = [...card.querySelectorAll('button')].find((x) => (x.textContent || '').startsWith('${prefix}')); return b ? b.textContent : ''; })()`);
      if (String(now).includes(optionText)) return true;
      await wait(800);
    }
    return false;
  };
  check('picked Contact = Spoke with them', await pick('Contact:', 'Spoke with them'));
  // The strip goes to its skeleton and comes back with the filter named in its sub-line.
  check('strip re-rendered with the filter named', await until(`/Spoke with them/.test(document.querySelector('div[aria-label="Depositors"]')?.textContent || '')`, 80));
  const after = await readStrip();
  console.log('strip, Spoke with them: ' + JSON.stringify(after));
  check('the depositor count CHANGED with the filter', before.depositors !== after.depositors);
  check('the EUR total CHANGED with the filter', before.eur !== after.eur && /EUR [0-9,]+ normalised/.test(after.eur));
  const tableCount = await evalJs(`document.querySelector('section[aria-label="Player activity"], section[aria-label="Depositors"]')?.querySelector('[aria-label="Players shown"]')?.textContent`);
  console.log('table shows ' + tableCount + ' players under that filter (Deposited = Any, so more than the depositors)');

  await evalJs(`document.querySelector('[aria-label="Money in the window"]')?.scrollIntoView({ block: 'start' })`);
  await wait(400);
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync('scratchpad/_shot-0910-strip-follows-filters.png', Buffer.from(shot.result.data, 'base64'));
  console.log('screenshot: scratchpad/_shot-0910-strip-follows-filters.png');
  console.log('\n' + (failures === 0 ? 'PROBE PASSED' : 'PROBE FAILED — ' + failures + ' red'));
  sock.close(); chrome.kill(); try { execSync('taskkill /F /PID ' + chrome.pid + ' /T', { stdio: 'ignore' }); } catch {}
  process.exit(failures === 0 ? 0 : 1);
})();
