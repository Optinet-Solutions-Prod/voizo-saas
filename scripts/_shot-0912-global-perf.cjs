/* _shot-0912-global-perf.cjs — shoot Global Performance after moving it onto the transcript
 * classifier, and read the rendered numbers back out of the DOM.
 *
 * The gate proves the route. This proves the PAGE: that the card renders a Silent pickup row with
 * a non-zero count, and that what a person sees equals what the route returned. On 11 Sep a
 * screenshot caught a bug every gate had passed, so the numbers get read from the rendered DOM
 * here rather than trusted from JSON.
 */
const fs = require('fs'); const os = require('os'); const path = require('path'); const { spawn } = require('child_process');
const env = {};
for (const l of fs.readFileSync('C:/Users/jasin/Desktop/voizo/Voizo/.env.local', 'utf8').split(/\r?\n/)) {
  const i = l.indexOf('='); if (i > 0 && !l.startsWith('#')) env[l.slice(0, i).trim()] = l.slice(i + 1).trim().replace(/^(["'])(.*)\1$/, '$2');
}
const chromePath = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe', process.env.LOCALAPPDATA + '/Google/Chrome/Application/chrome.exe'].find((p) => p && fs.existsSync(p));
const auth = 'Basic ' + Buffer.from(env.DASHBOARD_USERNAME + ':' + env.DASHBOARD_PASSWORD).toString('base64');
let failures = 0;
const check = (n, ok, d) => { console.log((ok ? '  PASS  ' : '  FAIL  ') + n + (d ? '   ' + d : '')); if (!ok) failures++; };

(async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'voizo-gp-'));
  const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--remote-debugging-port=9361', '--user-data-dir=' + profile, '--window-size=1700,1400', 'about:blank'], { stdio: 'ignore' });
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  let ws = null;
  for (let i = 0; i < 40 && !ws; i++) { await wait(250); try { const l = await (await fetch('http://127.0.0.1:9361/json/list')).json(); const p = l.find((t) => t.type === 'page'); if (p) ws = p.webSocketDebuggerUrl; } catch {} }
  const sock = new WebSocket(ws); let id = 0; const pending = new Map();
  sock.addEventListener('message', (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
  await new Promise((r) => sock.addEventListener('open', r));
  const send = (m, p) => new Promise((res) => { const mid = ++id; pending.set(mid, res); sock.send(JSON.stringify({ id: mid, method: m, params: p || {} })); });
  const ev = async (e) => (await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true })).result?.result?.value;
  const until = async (e, n = 240) => { for (let i = 0; i < n; i++) { if (await ev(e)) return true; await wait(500); } return false; };

  await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
  await send('Network.setExtraHTTPHeaders', { headers: { Authorization: auth } });
  await send('Page.navigate', { url: 'http://localhost:3111/analytics' });

  check('the Global Performance card rendered a Silent pickup row',
    await until(`/Silent pickup/.test(document.body.textContent)`));

  // data.perf from /api/dashboard/analytics renders as the CONVERSION FUNNEL, not as a
  // Silent-pickup row — that row belongs to Today's Performance, one card above, which is why an
  // unscoped scan for "Silent pickup" proved the wrong card twice. The funnel's "Conversations
  // established" IS perf.reached.total, so it is the number this change moves: 390 -> 200 at 7d.
  const found = await ev(`(() => {
    const hit = [...document.querySelectorAll('*')]
      .find((e) => e.children.length === 0 && (e.textContent || '').trim() === 'Conversion Funnel');
    if (!hit) return 0;
    let card = hit;
    for (let i = 0; i < 7 && card.parentElement; i++) {
      card = card.parentElement;
      if (card.getBoundingClientRect().height > 200) break;
    }
    card.setAttribute('data-probe-funnel', '1');
    card.scrollIntoView({ block: 'center' });
    return 1;
  })()`);
  check('found the Conversion Funnel card', Number(found) === 1);
  await wait(1000);

  const text = String(await ev(`(() => { const el = document.querySelector('[data-probe-funnel]'); return el ? el.innerText : ''; })()`) || '');
  console.log('  rendered: ' + JSON.stringify(text.replace(/\s+/g, ' ').slice(0, 260)));
  const num = (label) => {
    const m = text.replace(/\s+/g, ' ').match(new RegExp(label + '[^0-9]{0,60}([0-9,]+)'));
    return m ? Number(m[1].replace(/,/g, '')) : undefined;
  };
  const api = JSON.parse(await ev(`fetch('/api/dashboard/analytics?range=7d').then(r=>r.json()).then(j=>JSON.stringify({attempts:j.perf.callAttempts.total,reached:j.perf.reached.total,silent:(j.perf.callAttempts.rows.find(r=>r.key==='silent_pickup')||{}).count}))`));
  console.log('  route   : ' + JSON.stringify(api));
  check('the funnel renders Conversations established', Number.isFinite(num('Conversations established')), String(num('Conversations established')));
  check('rendered Conversations established equals the route', num('Conversations established') === api.reached, `${num('Conversations established')} vs ${api.reached}`);
  check('the route now classifies silent pickups (was 0 before this change)', api.silent > 0, String(api.silent));

  const box = await ev(`(() => { const el = document.querySelector('[data-probe-funnel]'); const r = el.getBoundingClientRect(); return JSON.stringify({x:Math.max(0,Math.floor(r.x)-10),y:Math.max(0,Math.floor(r.y)-10),width:Math.ceil(r.width)+20,height:Math.ceil(r.height)+20}); })()`);
  const shot = await send('Page.captureScreenshot', { format: 'png', clip: { ...JSON.parse(box), scale: 2 } });
  fs.writeFileSync('scratchpad/_shot-0912-global-funnel.png', Buffer.from(shot.result.data, 'base64'));
  console.log('  wrote scratchpad/_shot-0912-global-funnel.png');

  sock.close(); chrome.kill();
  console.log('\n' + (failures ? 'FAILURES: ' + failures : 'ALL GREEN'));
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.log('FATAL ' + e.message); process.exit(1); });
