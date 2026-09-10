// _shot-0911-reach-card.cjs — prove on the RUNNING page that the merged Reach card is there, that it
// follows the window, and that Contact this window is gone. A gate proves the numbers; only a
// screenshot proves the page.
//
// Shoots the card at 7d and at All, reads its seven rows out of the rendered DOM, and asserts:
//   the card exists and names its window and its denominator in the header;
//   all seven rows render, "Answered" and "Spoke with them" both present and different;
//   the DOM numbers equal what /api/audience/deposits answered for the same window;
//   no "Contact this window" section is left anywhere on the page;
//   no row reads "none yet" (the old Emailed placeholder is gone).
//
// The Audience page renders SKELETONS without their aria-labels, so wait for the Depositors table,
// not for the card (2026-09-10 lesson), and click nothing before React has attached.
const fs = require('fs'); const os = require('os'); const path = require('path'); const { spawn } = require('child_process');
const env = {}; for (const l of fs.readFileSync('C:/Users/jasin/Desktop/voizo/Voizo/.env.local', 'utf8').split(/\r?\n/)) { const i = l.indexOf('='); if (i > 0 && !l.startsWith('#')) env[l.slice(0, i).trim()] = l.slice(i + 1).trim().replace(/^(["'])(.*)\1$/, '$2'); }
const chromePath = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe', process.env.LOCALAPPDATA + '/Google/Chrome/Application/chrome.exe'].find((p) => p && fs.existsSync(p));
const auth = 'Basic ' + Buffer.from(env.DASHBOARD_USERNAME + ':' + env.DASHBOARD_PASSWORD).toString('base64');
let failures = 0;
const check = (name, ok, detail) => { console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (detail ? '   ' + detail : '')); if (!ok) failures++; };
// Keyed on aria-label, not on the label cell's text: the cell also carries the Info glyph, which
// is why the header reads 'Reachi' in a raw textContent dump (2026-09-11).
const ROWS = ['Dialled', 'Answered', 'Spoke with them', 'Texted', 'Text delivered', 'Email follow-up sent', 'Deposited after contact'];

(async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'voizo-reach-'));
  const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--remote-debugging-port=9341', '--user-data-dir=' + profile, '--window-size=1700,1200', 'about:blank'], { stdio: 'ignore' });
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  let ws = null;
  for (let i = 0; i < 40 && !ws; i++) { await wait(250); try { const l = await (await fetch('http://127.0.0.1:9341/json/list')).json(); const p = l.find((t) => t.type === 'page'); if (p) ws = p.webSocketDebuggerUrl; } catch {} }
  const sock = new WebSocket(ws); let id = 0; const pending = new Map();
  sock.addEventListener('message', (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
  await new Promise((r) => sock.addEventListener('open', r));
  const send = (method, params) => new Promise((res) => { const mid = ++id; pending.set(mid, res); sock.send(JSON.stringify({ id: mid, method, params: params || {} })); });
  const evalJs = async (e) => (await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true })).result?.result?.value;
  const until = async (e, n = 160) => { for (let i = 0; i < n; i++) { if (await evalJs(e)) return true; await wait(500); } return false; };
  await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
  await send('Network.setExtraHTTPHeaders', { headers: { Authorization: auth } });

  /** The card's header and its seven rows, straight out of the rendered DOM. */
  const readCard = () => evalJs(`(() => {
    const s = document.querySelector('section[aria-label="Reach"]');
    if (!s) return null;
    const head = s.querySelector('h2')?.parentElement?.textContent || '';
    const rows = {};
    for (const r of s.querySelectorAll('[role="row"]')) {
      const cells = [...r.children].map((c) => c.textContent.trim());
      rows[r.getAttribute('aria-label')] = { pct: cells[2], n: cells[3] };
    }
    const notes = [...s.querySelectorAll('p')].map((p) => p.textContent.trim());
    return { head: head.replace(/\\s+/g, ' ').trim(), rows, notes, text: s.textContent };
  })()`);

  const shoot = async (file, label) => {
    const box = await evalJs(`(() => { const s = document.querySelector('section[aria-label="Reach"]'); if (!s) return null; const r = s.getBoundingClientRect(); return JSON.stringify({ x: Math.floor(r.x) - 8, y: Math.floor(r.y) - 8, width: Math.ceil(r.width) + 16, height: Math.ceil(r.height) + 16 }); })()`);
    if (!box) return check(label + ': screenshot', false, 'no card to shoot');
    const clip = { ...JSON.parse(box), scale: 2 };
    const shot = await send('Page.captureScreenshot', { format: 'png', clip, captureBeyondViewport: true });
    fs.writeFileSync(file, Buffer.from(shot.result.data, 'base64'));
    console.log('  wrote ' + file);
  };

  for (const [range, name, file] of [['7d', '7d', 'scratchpad/_shot-0911-reach-7d.png'], ['All', 'All', 'scratchpad/_shot-0911-reach-all.png']]) {
    console.log('\n=== ' + name + ' ===');
    await send('Page.navigate', { url: 'http://localhost:3111/audience' });
    check(name + ': page loaded and hydrated',
      await until(`!!document.querySelector('div[aria-label="Depositors"]') && !!document.querySelector('section[aria-label="Player activity"] tbody tr td')`));
    if (range !== '7d') {
      // The range presets are the only buttons whose whole label is the preset key.
      await evalJs(`(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === '${range}'); b && b.click(); })()`);
      await wait(1200);
    }
    check(name + ': the Reach card rendered its numbers',
      await until(`(() => { const s = document.querySelector('section[aria-label="Reach"]'); return !!s && /players contacted/.test(s.textContent) && s.querySelectorAll('[role="row"]').length === 7; })()`));
    const card = await readCard();
    if (!card) { check(name + ': card present', false); continue; }
    console.log('  header: ' + card.head);
    for (const r of ROWS) console.log('    ' + r.padEnd(22) + (card.rows[r] ? card.rows[r].pct.padStart(7) + '  ' + card.rows[r].n.padStart(7) : 'MISSING'));
    for (const note of card.notes) console.log('    · ' + note);

    for (const r of ROWS) check(name + ': row "' + r + '" is on the card', !!card.rows[r]);
    check(name + ': both reach rules are shown and they differ',
      !!card.rows['Answered'] && !!card.rows['Spoke with them'] && card.rows['Answered'].n !== card.rows['Spoke with them'].n,
      (card.rows['Answered'] || {}).n + ' answered vs ' + (card.rows['Spoke with them'] || {}).n + ' spoke');
    check(name + ': the header names the window and the denominator', /players contacted ·/.test(card.head), card.head);
    check(name + ': no row reads "none yet" any more', !/none yet/.test(card.text));
    check(name + ': "Contact this window" is gone from the page',
      !(await evalJs(`/Contact this window/.test(document.body.textContent)`)));

    // The DOM must agree with the route for the SAME window: a card that renders a stale answer
    // passes every SQL gate and still shows the operator the wrong number.
    const api = await evalJs(`fetch('/api/audience/deposits?range=${range === 'All' ? 'lifetime' : range}').then(r => r.json()).then(j => JSON.stringify(j.reach))`);
    const a = JSON.parse(api);
    const num = (s) => Number(String(s).replace(/[^0-9]/g, ''));
    check(name + ': the DOM numbers equal the route for the same window',
      num(card.rows['Dialled'].n) === a.dialled && num(card.rows['Answered'].n) === a.answered &&
      num(card.rows['Spoke with them'].n) === a.spoke && num(card.rows['Texted'].n) === a.texted &&
      num(card.rows['Email follow-up sent'].n) === a.emailed && num(card.rows['Deposited after contact'].n) === a.depositors,
      'route ' + [a.dialled, a.answered, a.spoke, a.texted, a.emailed, a.depositors].join('/'));
    await shoot(file, name);
  }

  sock.close(); chrome.kill();
  console.log('\n' + (failures ? 'FAILURES: ' + failures : 'ALL GREEN'));
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.log('SHOT ERROR: ' + e.message); process.exit(1); });
