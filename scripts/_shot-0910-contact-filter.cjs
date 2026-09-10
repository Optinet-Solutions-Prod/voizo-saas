/* _shot-0910-contact-filter.cjs — screenshot the Audience Contact filter with the new options open.
 * A gate proves the numbers; only a screenshot proves the page.
 *
 * Drives the REAL dev server (localhost:3111) over raw CDP: no puppeteer, no new dependency.
 * Basic auth comes from the main checkout's .env.local, the same file dev-start.cjs reads.
 *
 * Known artefacts this recipe already accounts for (learned the hard way, 08 Sep):
 *   - headless Chrome freezes CSS transitions, so a menu that animates open can be captured
 *     mid-flight; we wait on the option TEXT being present in the DOM, not on a timer alone;
 *   - skeleton rows satisfy a naive "tbody tr td" wait, so we wait for the filter control itself;
 *   - the page ignores range= in the URL, so nothing here depends on it.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execSync } = require('child_process');

const OUT = process.argv[2] || path.join(process.cwd(), 'scratchpad', '_shot-0910-contact-filter.png');
const PORT = 3111;
const env = {};
for (const l of fs.readFileSync('C:/Users/jasin/Desktop/voizo/Voizo/.env.local', 'utf8').split(/\r?\n/)) {
  const i = l.indexOf('=');
  if (i > 0 && !l.startsWith('#')) env[l.slice(0, i).trim()] = l.slice(i + 1).trim().replace(/^(["'])(.*)\1$/, '$2');
}
const USER = env.DASHBOARD_USERNAME, PASS = env.DASHBOARD_PASSWORD;
if (!USER || !PASS) throw new Error('DASHBOARD_USERNAME / DASHBOARD_PASSWORD missing from .env.local');

function findChrome() {
  const guesses = [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    process.env.LOCALAPPDATA + '/Google/Chrome/Application/chrome.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  ];
  for (const g of guesses) if (g && fs.existsSync(g)) return g;
  throw new Error('no Chrome or Edge found');
}

(async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'voizo-shot-'));
  const chrome = spawn(findChrome(), [
    '--headless=new', '--disable-gpu', '--hide-scrollbars',
    '--remote-debugging-port=9333', '--user-data-dir=' + profile,
    '--window-size=1600,1000', 'about:blank',
  ], { stdio: 'ignore' });

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  let ws = null;
  for (let i = 0; i < 40 && !ws; i++) {
    await wait(250);
    try {
      const list = await (await fetch('http://127.0.0.1:9333/json/list')).json();
      const page = list.find((t) => t.type === 'page');
      if (page) ws = page.webSocketDebuggerUrl;
    } catch { /* not up yet */ }
  }
  if (!ws) { chrome.kill(); throw new Error('CDP never came up'); }

  const WebSocket = (await import('node:http')).default && globalThis.WebSocket;
  const sock = new WebSocket(ws);
  let id = 0;
  const pending = new Map();
  sock.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  });
  await new Promise((r) => sock.addEventListener('open', r));
  const send = (method, params) => new Promise((resolve) => {
    const mid = ++id;
    pending.set(mid, resolve);
    sock.send(JSON.stringify({ id: mid, method, params: params || {} }));
  });
  const evalJs = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    return r.result?.result?.value;
  };

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Network.enable');
  await send('Network.setExtraHTTPHeaders', {
    headers: { Authorization: 'Basic ' + Buffer.from(USER + ':' + PASS).toString('base64') },
  });

  await send('Page.navigate', { url: 'http://localhost:3111/audience' });

  // Wait for the Contact filter itself, not for any old table cell: skeleton rows satisfy a
  // naive row wait while the real control is still absent.
  let ready = false;
  for (let i = 0; i < 120; i++) {
    await wait(500);
    // The card that carries the filter mounts only once the lane query returns. Waiting on the
    // section is what separates a loaded page from a page full of skeleton blocks, which a naive
    // DOM check cannot tell apart.
    ready = await evalJs(`!!document.querySelector('section[aria-label="Player activity"], section[aria-label="Depositors"]')`);
    if (ready) break;
  }
  if (!ready) {
    const head = await evalJs('document.body ? document.body.innerText.slice(0,400) : "(no body)"');
    console.log('PAGE DID NOT REACH THE FILTER. First 400 chars:\n' + head);
  }

  // The money strip and both reach cards render SKELETONS until their queries return, and the
  // skeleton branch emits none of the aria-labels the copy check reads — so a check that runs too
  // early reports copy as missing when it is present. Wait for the loaded Depositors stat itself.
  let loaded = false;
  for (let i = 0; i < 120; i++) {
    loaded = await evalJs(`!!document.querySelector('[aria-label="Depositors"]')`);
    if (loaded) break;
    await wait(500);
  }
  if (!loaded) console.log('THE MONEY STRIP NEVER LEFT ITS SKELETON — the copy check below would read as missing.');

  // Open the Contact select and prove the new options are really in the DOM.
  const opened = await evalJs(`(() => {
    const card = document.querySelector('section[aria-label="Player activity"], section[aria-label="Depositors"]');
    if (!card) return 'no players card';
    // Scroll the card to the top of the viewport BEFORE opening the menu: the control sits well
    // below the fold at 1600x1000, so a capture without this shows the page header instead.
    card.scrollIntoView({ block: 'start' });
    const el = [...card.querySelectorAll('button,[role="combobox"],select')]
      .find((b) => /Contact:/.test(b.textContent || ''));
    if (!el) return 'card present but no Contact control';
    el.click();
    return 'clicked ' + el.tagName + ' "' + (el.textContent || '').trim().slice(0, 40) + '"';
  })()`);
  await wait(700);
  const optionText = await evalJs(`document.body.innerText.match(/Spoke with them[\\s\\S]{0,80}/)?.[0] ?? '(not in the DOM)'`);

  // VOZ-512: each depositor number must NAME its population, on screen and in the hover.
  // Info renders its text into aria-label on a role="note", not a native title, so a source grep
  // misses it entirely — read the rendered DOM instead (08 Sep lesson).
  const pops = await evalJs(`(() => {
    const notes = [...document.querySelectorAll('[role="note"][aria-label]')].map((n) => n.getAttribute('aria-label'));
    return {
      depositorsStat: (document.querySelector('[aria-label="Depositors"]')?.textContent || '(no Depositors stat)').trim(),
      contactSub: (document.querySelector('section[aria-label="Contact this window"] p.font-mono')?.textContent || '(none)').trim(),
      reachSub: (document.querySelector('[aria-label="Gross deposited after contact"]')?.textContent || '(none)').trim(),
      hoverWindow: notes.some((t) => /deposited inside this window/i.test(t)),
      hoverContacted: notes.some((t) => /players contacted inside this window/i.test(t)),
      hoverAllTime: notes.some((t) => /over ALL TIME/i.test(t)),
    };
  })()`);
  console.log('depositors stat:   ' + JSON.stringify(pops.depositorsStat));
  console.log('contact sub-line:  ' + JSON.stringify(pops.contactSub));
  console.log('reach sub-line:    ' + JSON.stringify(pops.reachSub));
  console.log('hovers name their population — in-window ' + pops.hoverWindow +
    ', contacted-in-window ' + pops.hoverContacted + ', all-time ' + pops.hoverAllTime);

  // Second shot: the three depositor cards themselves, which is what VOZ-512 changed.
  await evalJs(`document.querySelector('[aria-label="Money in the window"]')?.scrollIntoView({ block: 'start' })`);
  await wait(400);
  const cardsShot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  if (cardsShot.result?.data) {
    const p2 = OUT.replace(/\.png$/, '-cards.png');
    fs.mkdirSync(path.dirname(p2), { recursive: true });
    fs.writeFileSync(p2, Buffer.from(cardsShot.result.data, 'base64'));
    console.log('cards screenshot: ' + p2);
  }

  // Back to the filter for the primary shot.
  await evalJs(`(() => {
    const card = document.querySelector('section[aria-label="Player activity"], section[aria-label="Depositors"]');
    if (!card) return;
    card.scrollIntoView({ block: 'start' });
    const el = [...card.querySelectorAll('button,[role="combobox"],select')].find((b) => /Contact:/.test(b.textContent || ''));
    if (el && !/Spoke with them/.test(document.body.innerText)) el.click();
  })()`);
  await wait(600);
  const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  const b64 = shot.result?.data;
  if (b64) {
    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    fs.writeFileSync(OUT, Buffer.from(b64, 'base64'));
  }

  console.log('filter control: ' + opened);
  console.log('option text in DOM: ' + JSON.stringify(optionText));
  console.log('screenshot: ' + (b64 ? OUT : 'FAILED'));

  sock.close();
  chrome.kill();
  try { execSync('taskkill /F /PID ' + chrome.pid + ' /T', { stdio: 'ignore' }); } catch { /* already gone */ }
  process.exit(0);
})();
