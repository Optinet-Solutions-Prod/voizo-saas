// _shot-0910-footer-eur.cjs — prove the footer EUR on the RUNNING page with Deposited=After contact + Contact=Spoke with them on 7d.
const fs = require('fs'); const os = require('os'); const path = require('path'); const { spawn, execSync } = require('child_process');
const env = {}; for (const l of fs.readFileSync('C:/Users/jasin/Desktop/voizo/Voizo/.env.local', 'utf8').split(/\r?\n/)) { const i = l.indexOf('='); if (i > 0 && !l.startsWith('#')) env[l.slice(0, i).trim()] = l.slice(i + 1).trim().replace(/^(["'])(.*)\1$/, '$2'); }
const chromePath = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe', process.env.LOCALAPPDATA + '/Google/Chrome/Application/chrome.exe'].find((p) => p && fs.existsSync(p));
(async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'voizo-footer-'));
  const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--remote-debugging-port=9335', '--user-data-dir=' + profile, '--window-size=1700,1000', 'about:blank'], { stdio: 'ignore' });
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  let ws = null; for (let i = 0; i < 40 && !ws; i++) { await wait(250); try { const l = await (await fetch('http://127.0.0.1:9335/json/list')).json(); const p = l.find((t) => t.type === 'page'); if (p) ws = p.webSocketDebuggerUrl; } catch {} }
  const sock = new WebSocket(ws); let id = 0; const pending = new Map();
  sock.addEventListener('message', (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
  await new Promise((r) => sock.addEventListener('open', r));
  const send = (method, params) => new Promise((res) => { const mid = ++id; pending.set(mid, res); sock.send(JSON.stringify({ id: mid, method, params: params || {} })); });
  const evalJs = async (e) => (await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true })).result?.result?.value;
  const until = async (e, n = 120) => { for (let i = 0; i < n; i++) { if (await evalJs(e)) return true; await wait(500); } return false; };
  await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
  await send('Network.setExtraHTTPHeaders', { headers: { Authorization: 'Basic ' + Buffer.from(env.DASHBOARD_USERNAME + ':' + env.DASHBOARD_PASSWORD).toString('base64') } });
  await send('Page.navigate', { url: 'http://localhost:3111/audience' });
  // Wait for HYDRATED, loaded state, not merely for the section to exist: the strip's Depositors stat
  // only renders once its query returns, and a select clicked before React attaches does nothing.
  const loaded = await until(`!!document.querySelector('div[aria-label="Depositors"]') && !!document.querySelector('section[aria-label="Player activity"] tbody tr td')`);
  console.log('page loaded and hydrated: ' + loaded);
  const pick = async (prefix, optionText) => {
    for (let attempt = 0; attempt < 5; attempt++) {
      await evalJs(`(() => { const card = document.querySelector('section[aria-label="Player activity"], section[aria-label="Depositors"]'); const b = [...card.querySelectorAll('button')].find((x) => (x.textContent || '').startsWith('${prefix}')); b && b.click(); })()`);
      await wait(400);
      await evalJs(`(() => { const o = [...document.querySelectorAll('[role="option"], li, button')].find((e) => (e.textContent || '').trim() === '${optionText}'); o && o.click(); })()`);
      await wait(600);
      // Verify the pick TOOK: the select's own label must now read the option.
      const now = await evalJs(`(() => { const card = document.querySelector('section[aria-label="Player activity"], section[aria-label="Depositors"]'); const b = [...card.querySelectorAll('button')].find((x) => (x.textContent || '').startsWith('${prefix}')); return b ? b.textContent : '(no select)'; })()`);
      if (String(now).includes(optionText)) { console.log('picked ' + prefix + ' ' + optionText); return true; }
      await wait(800);
    }
    console.log('FAILED to pick ' + prefix + ' ' + optionText);
    return false;
  };
  await pick('Deposited:', 'After contact');
  await pick('Contact:', 'Spoke with them');
  const ok = await until(`(() => { const s = document.querySelector('section[aria-label="Depositors"] [aria-label="EUR total for this page"]'); return !!s && /EUR [0-9,]+ normalised/.test(s.textContent); })()`, 80);
  const footer = await evalJs(`(document.querySelector('section[aria-label="Depositors"] [aria-label="EUR total for this page"]')?.parentElement?.textContent || '(no footer)').trim()`);
  const hover = await evalJs(`document.querySelector('section[aria-label="Depositors"] [aria-label="EUR total for this page"]')?.getAttribute('title') || '(no title)'`);
  const count = await evalJs(`document.querySelector('section[aria-label="Depositors"] [aria-label="Players shown"]')?.textContent`);
  console.log('EUR footer present: ' + ok);
  console.log('players shown: ' + count);
  console.log('footer: ' + footer);
  console.log('hover:  ' + hover);
  await evalJs(`document.querySelector('section[aria-label="Depositors"] [aria-label="EUR total for this page"]')?.scrollIntoView({ block: 'center' })`);
  await wait(300);
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync('scratchpad/_shot-0910-footer-eur.png', Buffer.from(shot.result.data, 'base64'));
  console.log('screenshot: scratchpad/_shot-0910-footer-eur.png');
  sock.close(); chrome.kill(); try { execSync('taskkill /F /PID ' + chrome.pid + ' /T', { stdio: 'ignore' }); } catch {}
})();
