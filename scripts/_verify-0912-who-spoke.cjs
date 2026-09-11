/* _verify-0912-who-spoke.cjs — READ-ONLY. Who actually spoke, 04-11 Sep?
 *
 * Gisela: "Established Conversations: 208 (3.3%)". Our dashboard: 406 reached (6.5%).
 * Neither is a transcript count, so this settles it from the transcripts themselves: a
 * conversation happened if the CUSTOMER said something. No taxonomy, no classifier.
 */
const fs = require('fs');
const log = (s) => process.stdout.write(s + '\n');
const env = {};
for (const l of fs.readFileSync('C:/Users/jasin/Desktop/voizo/Voizo/.env.local', 'utf8').split(/\r?\n/)) {
  const i = l.indexOf('=');
  if (i > 0 && !l.startsWith('#')) env[l.slice(0, i).trim()] = l.slice(i + 1).trim().replace(/^["']|["']$/g, '');
}
const h = { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: 'Bearer ' + env.SUPABASE_SERVICE_ROLE_KEY };

async function pageAll(qs) {
  const out = [];
  for (let f = 0; ; f += 500) {
    const r = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/calls_v2?${qs}`, {
      headers: { ...h, Range: `${f}-${f + 499}`, 'Range-Unit': 'items', Prefer: 'count=exact' },
    });
    if (!r.ok) throw new Error(`${r.status} ${(await r.text()).slice(0, 200)}`);
    const c = await r.json();
    out.push(...c);
    const tot = Number(String(r.headers.get('content-range') || '').split('/')[1]);
    if (c.length < 500) {
      if (Number.isFinite(tot) && out.length !== tot) throw new Error(`PAGING INCOMPLETE ${out.length}/${tot}`);
      return out;
    }
  }
}

(async () => {
  const rows = await pageAll('select=id,ended_reason,transcript,goal_reached,voicemail&created_at=gte.2026-09-04&created_at=lt.2026-09-12');
  log(`calls in window: ${rows.length}   (dashboard and Gisela both say 6,266)`);

  const labels = new Map();
  const turns = (c) => {
    const t = c.transcript && typeof c.transcript.text === 'string' ? c.transcript.text : '';
    let n = 0;
    for (const line of t.split('\n')) {
      const m = line.match(/^([A-Za-z]+):/);
      if (!m) continue;
      labels.set(m[1], (labels.get(m[1]) || 0) + 1);
      if (!/^AI$/i.test(m[1])) n++;
    }
    return n;
  };
  const all = rows.map((c) => ({ ...c, n: turns(c) }));
  const counted = all.filter((c) => c.voicemail !== true);
  log(`voicemail=true excluded: ${all.length - counted.length}; non-voicemail attempts: ${counted.length}`);
  log(`speaker labels in transcripts: ${[...labels.entries()].map(([k, v]) => `${k}=${v}`).join('  ')}`);

  const none = counted.filter((c) => !c.transcript || typeof c.transcript.text !== 'string' || !c.transcript.text.trim()).length;
  const spoke = counted.filter((c) => c.n > 0);
  log(`\n  no transcript at all               ${String(none).padStart(5)}`);
  log(`  transcript, AI only (never spoke)  ${String(counted.length - none - spoke.length).padStart(5)}`);
  log(`  CUSTOMER SPOKE at least once       ${String(spoke.length).padStart(5)}   = ${(100 * spoke.length / counted.length).toFixed(1)}% of attempts`);
  log(`     Gisela says 208 established (3.3%) · our dashboard says 406 reached (6.5%)`);
  for (const k of [2, 3, 5]) {
    log(`  customer spoke ${k}+ times            ${String(counted.filter((c) => c.n >= k).length).padStart(5)}`);
  }
  const byReason = new Map();
  for (const c of spoke) byReason.set(c.ended_reason ?? 'null', (byReason.get(c.ended_reason ?? 'null') || 0) + 1);
  log('\n  of those who spoke, by ended_reason:');
  for (const [k, n] of [...byReason].sort((a, b) => b[1] - a[1])) log(`    ${String(n).padStart(5)}  ${k}`);
  log(`\n  goal_reached among speakers: ${spoke.filter((c) => c.goal_reached).length} (Gisela: 41 positive)`);
})().catch((e) => { log('FATAL ' + e.message); process.exit(1); });
