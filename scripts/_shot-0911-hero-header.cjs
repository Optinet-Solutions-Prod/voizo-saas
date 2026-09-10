// _shot-0911-hero-header.cjs — prove on the RUNNING page: the one-row toolbar, and the connect-rate
// hero whose bars now encode CALLS per period with the connect rate inside them.
//
// Asserts, then shoots the top of the page at 7d and at 30d (30d exercises the label-thinning rule):
//   the toolbar is ONE row: the title, the market tabs, the presets, the picker and Export share a
//     single flex row, so their bounding boxes overlap vertically;
//   the hero's bar heights follow COMPLETED CALLS, not the rate — the tallest bar must be the day
//     with the most completed calls, which is the whole point of the change;
//   the per-day rate labels are on the bars;
//   the old duplicated split block is gone: "connected" and "not connected" legend rows.
const fs = require('fs'); const os = require('os'); const path = require('path'); const { spawn } = require('child_process');
const env = {}; for (const l of fs.readFileSync('C:/Users/jasin/Desktop/voizo/Voizo/.env.local', 'utf8').split(/\r?\n/)) { const i = l.indexOf('='); if (i > 0 && !l.startsWith('#')) env[l.slice(0, i).trim()] = l.slice(i + 1).trim().replace(/^(["'])(.*)\1$/, '$2'); }
const chromePath = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe', process.env.LOCALAPPDATA + '/Google/Chrome/Application/chrome.exe'].find((p) => p && fs.existsSync(p));
const auth = 'Basic ' + Buffer.from(env.DASHBOARD_USERNAME + ':' + env.DASHBOARD_PASSWORD).toString('base64');
let failures = 0;
const check = (name, ok, detail) => { console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (detail ? '   ' + detail : '')); if (!ok) failures++; };

(async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'voizo-hero-'));
  const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--remote-debugging-port=9343', '--user-data-dir=' + profile, '--window-size=1700,1200', 'about:blank'], { stdio: 'ignore' });
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  let ws = null;
  for (let i = 0; i < 40 && !ws; i++) { await wait(250); try { const l = await (await fetch('http://127.0.0.1:9343/json/list')).json(); const p = l.find((t) => t.type === 'page'); if (p) ws = p.webSocketDebuggerUrl; } catch {} }
  const sock = new WebSocket(ws); let id = 0; const pending = new Map();
  sock.addEventListener('message', (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
  await new Promise((r) => sock.addEventListener('open', r));
  const send = (m, p) => new Promise((res) => { const mid = ++id; pending.set(mid, res); sock.send(JSON.stringify({ id: mid, method: m, params: p || {} })); });
  const evalJs = async (e) => (await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true })).result?.result?.value;
  const until = async (e, n = 160) => { for (let i = 0; i < n; i++) { if (await evalJs(e)) return true; await wait(500); } return false; };
  await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
  await send('Network.setExtraHTTPHeaders', { headers: { Authorization: auth } });

  for (const [range, name, file] of [['7d', '7d', 'scratchpad/_shot-0911-hero-7d.png'], ['30d', '30d', 'scratchpad/_shot-0911-hero-30d.png']]) {
    console.log('\n=== ' + name + ' ===');
    await send('Page.navigate', { url: 'http://localhost:3111/audience' });
    check(name + ': page loaded and hydrated', await until(`!!document.querySelector('[aria-label="Calls and connect rate by day"], [aria-label="Calls and connect rate by week"]') && !!document.querySelector('section[aria-label="Player activity"] tbody tr td')`));
    if (range !== '7d') {
      const days = range.replace('d', '');
      await evalJs(`(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === '${range}'); b && b.click(); })()`);
      // WAIT for the treatment to land, never a fixed sleep: analytics answers 30d in ~2.8 s, so a
      // 2.5 s sleep read the 7d series back and every 30d assertion passed against 7d numbers
      // (2026-09-11). The hero prints its own window, so that is the thing to wait on.
      check(name + ': the range switch actually landed',
        await until(`/${days}-day series/.test(document.body.textContent)`, 60));
    }

    // ── the toolbar is one row ──
    // DOM containment, not geometry: the app shell has its own <h1>Audience</h1> above the page's
    // (two matched at y 18 and y 76 on 2026-09-11), so querySelector('h1') measured the wrong one.
    // The market tablist is unique to this page, so its row is the row under test.
    const rowOk = await evalJs(`(() => {
      const tabs = document.querySelector('[role="tablist"][aria-label="Markets"]');
      if (!tabs) return 'no market tablist';
      const row = tabs.parentElement;
      const h1 = row.querySelector('h1');
      const presets = [...row.querySelectorAll('button')].filter((b) => /^(7d|14d|30d|60d|90d|All)$/.test(b.textContent.trim()));
      const exp = [...row.querySelectorAll('button')].filter((b) => /Export/.test(b.textContent));
      const missing = [!h1 && 'title', presets.length < 6 && 'presets(' + presets.length + ')', !exp.length && 'export'].filter(Boolean);
      if (missing.length) return 'not in the row: ' + missing.join(', ');
      // and the row really is one line: its height is a single control's, not two stacked
      return row.getBoundingClientRect().height < 60 ? 'ok' : 'row is ' + row.getBoundingClientRect().height.toFixed(0) + 'px tall, looks stacked';
    })()`);
    check(name + ': title, market tabs, presets and Export share ONE row', rowOk === 'ok', String(rowOk));

    // ── the bars encode calls, not rate ──
    const bars = JSON.parse(await evalJs(`(() => {
      const box = document.querySelector('[aria-label="Calls and connect rate by day"], [aria-label="Calls and connect rate by week"]');
      if (!box) return 'null';
      const out = [];
      for (const col of box.children) {
        const t = col.getAttribute('title') || '';
        const bar = col.querySelector('span[style*="height"]');
        const m = t.match(/([\\d,]+) of ([\\d,]+) connected \\(([\\d.]+)%\\)/);
        out.push({
          title: t,
          h: bar ? parseFloat((bar.getAttribute('style').match(/height:\\s*([\\d.]+)%/) || [0, 0])[1]) : 0,
          px: bar ? bar.getBoundingClientRect().height : 0,
          connected: m ? Number(m[1].replace(/,/g, '')) : null,
          terminal: m ? Number(m[2].replace(/,/g, '')) : null,
          rate: m ? Number(m[3]) : null,
          rateLabel: (col.firstElementChild.textContent || '').trim(),
        });
      }
      return JSON.stringify(out);
    })()`));
    const withCalls = bars.filter((b) => b.terminal);
    console.log('  bars: ' + bars.length + ', with calls: ' + withCalls.length);
    for (const b of withCalls.slice(0, 8)) console.log('    ' + b.title.replace(/ \(includes.*/, '') + '   height ' + b.h.toFixed(1) + '%  label "' + b.rateLabel + '"');

    const tallest = withCalls.reduce((a, b) => (b.h > a.h ? b : a), withCalls[0]);
    const busiest = withCalls.reduce((a, b) => (b.terminal > a.terminal ? b : a), withCalls[0]);
    check(name + ': the TALLEST bar is the period with the most completed calls',
      tallest.terminal === busiest.terminal, 'tallest ' + tallest.terminal + ' calls, busiest ' + busiest.terminal);
    // PIXELS, not the inline style. The style said 56.9% and 100.0% while both bars rendered the
    // same height, because the percentage resolved against a column that also holds two label rows
    // and the tall ones hit the ceiling (2026-09-11). Every number-level check passed through it.
    const busiestBar = withCalls.reduce((a, b) => (b.terminal > a.terminal ? b : a), withCalls[0]);
    const quietest = withCalls.reduce((a, b) => (b.terminal < a.terminal ? b : a), withCalls[0]);
    const callRatio = quietest.terminal / busiestBar.terminal;
    const pxRatio = busiestBar.px ? quietest.px / busiestBar.px : 0;
    check(name + ': bar PIXEL heights are in the same ratio as the calls (nothing is clamped)',
      Math.abs(pxRatio - callRatio) < 0.06,
      quietest.terminal + '/' + busiestBar.terminal + ' calls = ' + callRatio.toFixed(3) + ' vs pixels ' +
      quietest.px.toFixed(1) + '/' + busiestBar.px.toFixed(1) + ' = ' + pxRatio.toFixed(3));

    const bestRate = withCalls.reduce((a, b) => (b.rate > a.rate ? b : a), withCalls[0]);
    check(name + ': height does NOT follow the rate (the defect this replaces)',
      withCalls.length < 2 || bestRate.terminal === busiest.terminal || bestRate.h < tallest.h - 0.5,
      'best rate ' + bestRate.rate + '% at height ' + bestRate.h.toFixed(1) + '%, tallest ' + tallest.h.toFixed(1) + '%');
    check(name + ': every drawn bar carries its rate as a label',
      withCalls.every((b) => b.rateLabel === '' || /^\d+%$/.test(b.rateLabel)) && withCalls.some((b) => /%$/.test(b.rateLabel)),
      withCalls.map((b) => b.rateLabel).filter(Boolean).join(' '));
    // The window split moved OUT of the card's foot and UNDER the day bars, where it doubles as
    // their colour key (Jasiel 2026-09-11). It must sit inside the timeline column, and its two
    // counts must appear exactly once on the card.
    const split = await evalJs(`(() => {
      const bars = document.querySelector('[aria-label="Calls and connect rate by day"], [aria-label="Calls and connect rate by week"]');
      const bar = document.querySelector('[aria-label="Connected and not connected in this window"]');
      if (!bar) return 'no split bar';
      if (!bars || bars.parentElement !== bar.parentElement) return 'split bar is not in the timeline column';
      if (!(bars.compareDocumentPosition(bar) & Node.DOCUMENT_POSITION_FOLLOWING)) return 'split bar is above the day bars';
      const segs = [...bar.children].map((c) => parseFloat((c.getAttribute('style').match(/flex:\\s*([\\d.]+)/) || [0, 0])[1]));
      return segs.length === 2 && segs[0] > 0 && segs[1] > 0 ? 'ok' : 'segments ' + segs.join('/');
    })()`);
    check(name + ': the window split sits under the day bars, green and amber', split === 'ok', String(split));

    const counts = await evalJs(`(() => {
      const card = document.querySelector('[aria-label="Calls and connect rate by day"], [aria-label="Calls and connect rate by week"]').closest('.rounded-xl');
      const t = card.textContent;
      const api = ${JSON.stringify('')};
      const m = t.match(/([\\d,]+) \\/ ([\\d,]+)/);
      if (!m) return 'no "connected / did not" pair on the card';
      const conn = m[1], not = m[2];
      // stated once: the pair, and the "N of M completed calls" line, must not both repeat it
      const occurrences = (t.match(new RegExp(conn.replace(/,/g, ','), 'g')) || []).length;
      return occurrences <= 2 ? 'ok ' + conn + ' / ' + not : conn + ' appears ' + occurrences + ' times';
    })()`);
    check(name + ': the connected / did-not counts are on the card and not repeated', String(counts).startsWith('ok'), String(counts));

    const box = await evalJs(`(() => {
      const row = document.querySelector('[role="tablist"][aria-label="Markets"]').parentElement.getBoundingClientRect();
      const hero = document.querySelector('[aria-label="Calls and connect rate by day"], [aria-label="Calls and connect rate by week"]').closest('.rounded-xl').getBoundingClientRect();
      return JSON.stringify({ x: Math.max(0, Math.floor(Math.min(row.x, hero.x)) - 10), y: Math.max(0, Math.floor(row.y) - 12), width: Math.ceil(Math.max(row.width, hero.width)) + 20, height: Math.ceil(hero.bottom - row.top) + 24 });
    })()`);
    const shot = await send('Page.captureScreenshot', { format: 'png', clip: { ...JSON.parse(box), scale: 2 }, captureBeyondViewport: true });
    fs.writeFileSync(file, Buffer.from(shot.result.data, 'base64'));
    console.log('  wrote ' + file);
  }

  sock.close(); chrome.kill();
  console.log('\n' + (failures ? 'FAILURES: ' + failures : 'ALL GREEN'));
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.log('SHOT ERROR: ' + e.message); process.exit(1); });
