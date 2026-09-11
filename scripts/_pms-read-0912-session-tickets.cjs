/* _pms-read-0912-session-tickets.cjs — READ-ONLY. The board's own words on what we touched today.
 *
 * Jasiel: read the DESCRIPTIONS and COMMENTS, not just the titles. A ticket's comments are where
 * the acceptance criteria and the "do not do X" notes live, and shipping without reading them is
 * how a session delivers the wrong thing confidently.
 *
 * Reads only. Never POSTs — VOZ numbers collide, and the rule is to re-read the LIVE board before
 * any write. This script cannot write.
 *
 * Usage: node scripts/_pms-read-0912-session-tickets.cjs [VOZ-479 VOZ-511 ...]
 */
const fs = require('fs');
const log = (s) => process.stdout.write(s + '\n');
const env = {};
for (const l of fs.readFileSync('C:/Users/jasin/Desktop/voizo/Voizo/.env.local', 'utf8').split(/\r?\n/)) {
  const i = l.indexOf('=');
  if (i > 0 && !l.startsWith('#')) env[l.slice(0, i).trim()] = l.slice(i + 1).trim().replace(/^["']|["']$/g, '');
}
const BASE = (env.PMS_BASE_URL || 'https://pms-nu-eight.vercel.app').replace(/\/$/, '');
const KEY = env.PMS_API_KEY;
const PROJECT = 'cmnogr6ru000c04l2owfbhsij';

const gj = async (p) => {
  const r = await fetch(BASE + p, { headers: { Authorization: 'Bearer ' + KEY } });
  const t = await r.text();
  if (!r.ok) throw new Error(`GET ${p} -> ${r.status} ${t.slice(0, 200)}`);
  try { return JSON.parse(t); } catch { throw new Error(`GET ${p} -> unparseable: ${t.slice(0, 200)}`); }
};

// What this session actually touched. Anything else on the board is not our business today.
const WANTED = process.argv.slice(2).length
  ? process.argv.slice(2).map((s) => s.toUpperCase())
  : ['VOZ-479', 'VOZ-509', 'VOZ-511', 'VOZ-512', 'VOZ-513', 'VOZ-515', 'VOZ-516', 'VOZ-517', 'VOZ-518', 'VOZ-519'];

const strip = (html) => String(html ?? '')
  .replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n').replace(/<[^>]+>/g, '')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .split('\n').map((s) => s.trimEnd()).filter((s, i, a) => !(s === '' && a[i - 1] === '')).join('\n').trim();

(async () => {
  if (!KEY) { log('PMS_API_KEY not set — cannot read the board.'); process.exit(1); }
  const raw = await gj(`/api/projects/${PROJECT}/tasks`);
  const tasks = Array.isArray(raw) ? raw : (raw.tasks ?? raw.data ?? []);
  log(`board tasks: ${tasks.length}`);
  if (!tasks.length) { log('no tasks returned — check the project id'); return; }
  log(`task fields: ${Object.keys(tasks[0]).join(', ')}\n`);

  const keyOf = (t) => String(t.key ?? t.identifier ?? t.code ?? t.title ?? '').toUpperCase();
  const picked = tasks.filter((t) => WANTED.some((w) => keyOf(t).includes(w) || String(t.title ?? '').toUpperCase().includes(w)));
  log(`matched ${picked.length} of the ${WANTED.length} asked for: ${WANTED.join(' ')}\n`);
  const missing = WANTED.filter((w) => !picked.some((t) => (keyOf(t) + ' ' + String(t.title ?? '')).toUpperCase().includes(w)));
  if (missing.length) log(`NOT ON THE BOARD (or differently named): ${missing.join(' ')}\n`);

  for (const t of picked) {
    log('='.repeat(90));
    log(`${keyOf(t) || t.id}  ·  ${t.title ?? '(no title)'}`);
    log(`  status/column: ${t.status ?? t.columnId ?? t.column?.name ?? '?'}   updated: ${t.updatedAt ?? '?'}`);
    const desc = strip(t.description ?? t.body ?? '');
    log(desc ? `\n  --- DESCRIPTION ---\n${desc.split('\n').map((l) => '  ' + l).join('\n')}` : '\n  (no description)');

    // Comments may be inline on the task or need their own fetch; try inline first.
    let comments = t.comments ?? t.activity ?? null;
    if (!Array.isArray(comments)) {
      try {
        const full = await gj(`/api/tasks/${t.id}`);
        const node = full.task ?? full;
        comments = node.comments ?? node.activity ?? [];
      } catch (e) { comments = []; log(`  (comments unreadable: ${e.message.slice(0, 80)})`); }
    }
    if (!comments.length) { log('\n  (no comments)\n'); continue; }
    log(`\n  --- ${comments.length} COMMENT(S) ---`);
    for (const c of comments) {
      const who = c.author?.name ?? c.authorName ?? c.user?.name ?? c.createdBy ?? '?';
      const when = c.createdAt ?? c.updatedAt ?? '?';
      const text = strip(c.content ?? c.body ?? c.text ?? '');
      log(`  [${when}] ${who}:`);
      log(text.split('\n').map((l) => '     ' + l).join('\n'));
    }
    log('');
  }
})().catch((e) => { log('FATAL ' + e.message); process.exit(1); });
