/* _probe-0912-followup-landed.cjs — READ-ONLY. Did the follow-up we asked for actually GO OUT?
 *
 * The RoosterBet gap (110 triggers fired, 0 emails sent, found 8 days late by reading an email)
 * is not a one-off. We fire voizo_call_followup into a workspace we cannot see, and nothing on
 * our side notices when the campaign listening for it is paused, renamed or never built.
 *
 * VOZ-479 closed that blind spot this morning: cio_messages now holds what the CRM actually sent.
 * So the check is a join we could not write yesterday —
 *     cio_track_events  (what WE asked for)   ->   cio_messages  (what the CRM SENT)
 * matched per player, within a settle window.
 *
 * This is a FEASIBILITY PROBE, not the finished detector. It runs over the accounts VOZ-479 has
 * pulled so far, and its job is to answer one question: does the join actually discriminate a
 * workspace that delivers from one that does not?
 *
 * Usage: node scripts/_probe-0912-followup-landed.cjs [settleHours]
 */
const fs = require('fs');
const log = (s) => process.stdout.write(s + '\n');
const env = {};
for (const l of fs.readFileSync('C:/Users/jasin/Desktop/voizo/Voizo/.env.local', 'utf8').split(/\r?\n/)) {
  const i = l.indexOf('=');
  if (i > 0 && !l.startsWith('#')) env[l.slice(0, i).trim()] = l.slice(i + 1).trim().replace(/^["']|["']$/g, '');
}
const h = { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: 'Bearer ' + env.SUPABASE_SERVICE_ROLE_KEY };
const SETTLE_H = Number(process.argv[2] || 24);

async function pageAll(t, qs) {
  const out = [];
  for (let f = 0; ; f += 1000) {
    const r = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/${t}?${qs}`, {
      headers: { ...h, Range: `${f}-${f + 999}`, 'Range-Unit': 'items', Prefer: 'count=exact' },
    });
    if (!r.ok) throw new Error(`${t} ${r.status} ${(await r.text()).slice(0, 200)}`);
    const c = await r.json();
    out.push(...c);
    const tot = Number(String(r.headers.get('content-range') || '').split('/')[1]);
    if (c.length < 1000) {
      if (Number.isFinite(tot) && out.length !== tot) throw new Error(`PAGING INCOMPLETE ${t}: ${out.length}/${tot}`);
      return out;
    }
  }
}

(async () => {
  const fired = await pageAll('cio_track_events',
    'select=workspace,cio_id,event_name,created_at,status&event_name=eq.voizo_call_followup');
  const pulled = await pageAll('cio_delivery_sync', 'select=workspace,cio_id,last_pulled_at');
  const msgs = await pageAll('cio_messages', 'select=workspace,cio_id,type,sent_at,campaign_id');

  const haveCoverage = new Set(pulled.map((p) => `${p.workspace}|${p.cio_id}`));
  log(`voizo_call_followup events fired (all time): ${fired.length}`);
  log(`accounts VOZ-479 has pulled so far:          ${haveCoverage.size}`);
  log(`cio_messages rows held:                      ${msgs.length}\n`);

  // Only accounts we have actually pulled can be judged. Anything else is UNKNOWN, not a failure —
  // that distinction is the whole reason this is honest.
  const judgeable = fired.filter((f) => haveCoverage.has(`${f.workspace}|${f.cio_id}`));
  log(`events we can judge (player was pulled):     ${judgeable.length}`);
  if (judgeable.length === 0) {
    log('\n  Nothing to judge yet — the nightly pull has covered no player who got a follow-up.');
    log('  The detector is sound but needs the full pull to have run. Not a failure.');
  }

  const byWorkspace = new Map();
  for (const f of fired) {
    const w = byWorkspace.get(f.workspace) ?? { fired: 0, judgeable: 0, landed: 0 };
    w.fired++;
    if (haveCoverage.has(`${f.workspace}|${f.cio_id}`)) {
      w.judgeable++;
      const t0 = Date.parse(f.created_at);
      const landed = msgs.some((m) =>
        m.workspace === f.workspace && m.cio_id === f.cio_id && m.sent_at &&
        Date.parse(m.sent_at) >= t0 && Date.parse(m.sent_at) <= t0 + SETTLE_H * 3600_000);
      if (landed) w.landed++;
    }
    byWorkspace.set(f.workspace, w);
  }

  log(`\n── did a CRM message follow, within ${SETTLE_H}h of us asking? ──`);
  for (const [ws, w] of [...byWorkspace].sort((a, b) => b[1].fired - a[1].fired)) {
    const rate = w.judgeable ? `${(100 * w.landed / w.judgeable).toFixed(0)}%` : 'n/a';
    log(`  ${ws.padEnd(12)} fired ${String(w.fired).padStart(4)}   judgeable ${String(w.judgeable).padStart(3)}   landed ${String(w.landed).padStart(3)}   = ${rate}`);
  }

  // The control. A detector that reports 0% for everyone proves nothing: it has to show a
  // workspace that DOES deliver next to one that does not, or it is not measuring delivery.
  const judged = [...byWorkspace.values()].filter((w) => w.judgeable > 0);
  const anyLanded = judged.some((w) => w.landed > 0);
  const anyMissed = judged.some((w) => w.landed < w.judgeable);
  log(`\n  CONTROL: at least one workspace delivering — ${anyLanded ? 'YES' : 'NO'}`);
  log(`  CONTROL: at least one workspace falling short — ${anyMissed ? 'YES' : 'NO'}`);
  log(anyLanded && anyMissed
    ? '  -> the join DISCRIMINATES. This is a real detector.'
    : '  -> inconclusive so far; it cannot yet tell delivery from silence on this sample.');
})().catch((e) => { log('FATAL ' + e.message); process.exit(1); });
