// _shot-0911-strip-and-global.cjs — READ-ONLY. Two things the 2026-09-11 layout pass touched:
//   1. the Audience money strip's Gross tile: the EUR normalised total is now the hero and the
//      currencies sit under it, largest first (Jasiel). Asserts the hero IS the EUR figure, that
//      the breakdown is ordered by EUR value descending, and that nothing is truncated.
//   2. GLOBAL PERFORMANCE, which shares ConnectRateHero and passes NO Members tile. The hero was
//      rewritten into columns for the Audience tab; this proves the other consumer still renders.
const fs = require('fs'); const os = require('os'); const path = require('path'); const { spawn } = require('child_process');
const env = {}; for (const l of fs.readFileSync('C:/Users/jasin/Desktop/voizo/Voizo/.env.local', 'utf8').split(/\r?\n/)) { const i = l.indexOf('='); if (i > 0 && !l.startsWith('#')) env[l.slice(0, i).trim()] = l.slice(i + 1).trim().replace(/^(["'])(.*)\1$/, '$2'); }
const chromePath = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe', process.env.LOCALAPPDATA + '/Google/Chrome/Application/chrome.exe'].find((p) => p && fs.existsSync(p));
const auth = 'Basic ' + Buffer.from(env.DASHBOARD_USERNAME + ':' + env.DASHBOARD_PASSWORD).toString('base64');
let failures = 0;
const check = (n, ok, d) => { console.log((ok ? '  PASS  ' : '  FAIL  ') + n + (d ? '   ' + d : '')); if (!ok) failures++; };

(async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'voizo-strip2-'));
  const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--remote-debugging-port=9353', '--user-data-dir=' + profile, '--window-size=1700,1400', 'about:blank'], { stdio: 'ignore' });
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  let ws = null;
  for (let i = 0; i < 40 && !ws; i++) { await wait(250); try { const l = await (await fetch('http://127.0.0.1:9353/json/list')).json(); const p = l.find((t) => t.type === 'page'); if (p) ws = p.webSocketDebuggerUrl; } catch {} }
  const sock = new WebSocket(ws); let id = 0; const pending = new Map();
  sock.addEventListener('message', (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
  await new Promise((r) => sock.addEventListener('open', r));
  const send = (m, p) => new Promise((res) => { const mid = ++id; pending.set(mid, res); sock.send(JSON.stringify({ id: mid, method: m, params: p || {} })); });
  const evalJs = async (e) => (await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true })).result?.result?.value;
  const until = async (e, n = 200) => { for (let i = 0; i < n; i++) { if (await evalJs(e)) return true; await wait(500); } return false; };
  const shoot = async (sel, file) => {
    const box = await evalJs(`(() => { const el = document.querySelector('${sel}'); if (!el) return null; const r = el.getBoundingClientRect(); return JSON.stringify({ x: Math.max(0, Math.floor(r.x) - 8), y: Math.max(0, Math.floor(r.y) - 8), width: Math.ceil(r.width) + 16, height: Math.ceil(r.height) + 16 }); })()`);
    if (!box) return check('screenshot ' + file, false, 'no element');
    const s = await send('Page.captureScreenshot', { format: 'png', clip: { ...JSON.parse(box), scale: 2 }, captureBeyondViewport: true });
    fs.writeFileSync(file, Buffer.from(s.result.data, 'base64'));
    console.log('  wrote ' + file);
  };
  await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
  await send('Network.setExtraHTTPHeaders', { headers: { Authorization: auth } });

  console.log('\n=== 1. Audience money strip, Gross tile ===');
  await send('Page.navigate', { url: 'http://localhost:3111/audience' });
  check('strip rendered', await until(`(() => { const g = document.querySelector('[aria-label="Gross"]'); return !!g && /EUR/.test(g.textContent); })()`));
  const gross = JSON.parse(await evalJs(`(() => {
    const g = document.querySelector('[aria-label="Gross"]');
    const hero = g.children[1].textContent.trim();
    const sub = g.children[2] ? g.children[2].textContent.trim() : '';
    const brk = g.children[3] ? g.children[3].textContent.trim() : '';
    const clipped = [...g.querySelectorAll('*')].some((e) => e.scrollWidth > e.clientWidth + 1);
    return JSON.stringify({ hero, sub, brk, clipped });
  })()`));
  console.log('  hero:      ' + gross.hero);
  console.log('  sub:       ' + gross.sub);
  console.log('  breakdown: ' + gross.brk);
  check('the hero is the EUR normalised total', /^EUR [\d,]+$/.test(gross.hero), gross.hero);
  check('the sub says it is normalised', /normalised/.test(gross.sub), gross.sub);
  const api = JSON.parse(await evalJs(`fetch('/api/audience/deposits?range=7d').then(r=>r.json()).then(j=>JSON.stringify(j.deposits.totals))`));
  const expectEur = Math.round(api.reduce((a, t) => a + t.amountEur, 0)).toLocaleString('en-US');
  check('the hero equals the route\'s EUR sum', gross.hero === 'EUR ' + expectEur, gross.hero + ' vs EUR ' + expectEur);
  // the breakdown must be ordered by EUR VALUE descending, which is the only comparable ordering
  const order = api.filter((t) => t.deposits > 0).sort((a, b) => b.amountEur - a.amountEur).map((t) => t.currency);
  const shown = (gross.brk.match(/[A-Z]{3}/g) || []);
  check('the breakdown is largest to smallest by EUR value', JSON.stringify(shown) === JSON.stringify(order),
    shown.join(',') + ' vs ' + order.join(','));
  check('every currency is present, none dropped', shown.length === order.length, shown.length + ' of ' + order.length);
  check('nothing in the tile is clipped (the "NZ…" lesson, 2026-09-07)', !gross.clipped);
  await shoot('[aria-label="Money in the window"]', 'scratchpad/_shot-0911-money-strip.png');

  console.log('\n=== 2. Global Performance: the SAME hero with no Members tile ===');
  await send('Page.navigate', { url: 'http://localhost:3111/analytics' });
  const ok = await until(`(() => { const b = document.querySelector('[aria-label="Calls and connect rate by day"], [aria-label="Calls and connect rate by week"]'); return !!b && b.children.length > 0; })()`);
  check('the hero renders on Global Performance', ok);
  if (ok) {
    const g = JSON.parse(await evalJs(`(() => {
      const bars = document.querySelector('[aria-label="Calls and connect rate by day"], [aria-label="Calls and connect rate by week"]');
      const card = bars.closest('.rounded-xl');
      return JSON.stringify({
        members: !!card.querySelector('[aria-label="Members"]'),
        cols: card.firstElementChild.children.length,
        rate: /Connect rate/.test(card.textContent),
        split: !!card.querySelector('[aria-label="Connected and not connected in this window"]'),
        bars: bars.children.length,
        text: card.textContent.replace(/\\s+/g, ' ').slice(0, 150),
      });
    })()`));
    console.log('  ' + g.text);
    check('no Members column here (the dashboard passes no lead)', !g.members && g.cols === 2, 'columns ' + g.cols);
    check('the rate and the split bar both render', g.rate && g.split);
    check('the bars render', g.bars > 0, g.bars + ' bars');
    await shoot('[aria-label="Calls and connect rate by day"], [aria-label="Calls and connect rate by week"]', 'scratchpad/_shot-0911-global-hero.png');
    const card = await evalJs(`(() => { const b = document.querySelector('[aria-label="Calls and connect rate by day"], [aria-label="Calls and connect rate by week"]').closest('.rounded-xl'); b.setAttribute('data-shot',''); return true; })()`);
    if (card) await shoot('[data-shot]', 'scratchpad/_shot-0911-global-hero.png');
  }

  sock.close(); chrome.kill();
  console.log('\n' + (failures ? 'FAILURES: ' + failures : 'ALL GREEN'));
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.log('SHOT ERROR: ' + e.message); process.exit(1); });
