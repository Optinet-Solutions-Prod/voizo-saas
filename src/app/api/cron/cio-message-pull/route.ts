import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { supabaseAdmin } from "@/lib/supabaseServer";
import { CRON_NAMES, recordHeartbeat } from "@/lib/alerts/slack";
import { listConfiguredWorkspaces } from "@/lib/customerio";
import {
  deriveTimestamps,
  fetchCustomerMessages,
  newerIso,
  pullWindow,
  toMessageRow,
  type CioMessageRow,
} from "@/lib/cioMessages";

/**
 * VOZ-479 — the nightly Customer.io message pull (05:10 UTC, see vercel.json).
 *
 * Reads what the CRM sent every player Voizo contacted recently, into cio_messages. Reads only
 * from Customer.io; writes only to our own two tables. Costs nothing: GETs are free, no dial, no
 * text (§6 of the design).
 *
 * Query: dry=1 (pull and report, write nothing), days=30 (queue window), max=N (cap accounts,
 * for the gate), budgetMs=270000.
 *
 * BUDGET AND CARRY OVER (D4, revised 2026-09-12). The queue is 15,022 accounts and the prod rate
 * policy moves ~16 a second, so a full cycle is ~3.5 nights and a single night cannot drain it.
 * That is by design: work oldest-first, stop at the budget, leave the rest for tomorrow. A job
 * that cannot re-enter itself cannot storm the CRM's API on a bad day.
 *
 * WHY THE CHUNK LOOP IS HERE rather than chunkedPromiseAll(): that helper runs a whole list with
 * no early exit. With a 30s per-request timeout, one slow batch of 200 would run 750s and Vercel
 * would kill the function mid-write, losing the run's reporting and leaving last_pulled_at
 * unstamped. The rate policy is identical (8 in flight, 150ms apart — the same numbers three prod
 * callers use); only the budget check is added.
 */
export const maxDuration = 300;

const DEFAULT_BUDGET_MS = 270_000; // 30s of the 300s ceiling left for the final writes
const QUEUE_PAGE = 1_000;
const CHUNK = 8; // the prod-proven rate policy, see chunkedPromiseAll in customerio.ts
const CHUNK_DELAY_MS = 150;
const MAX_PAGES_PER_ACCOUNT = 20;
const MAX_RATE_LIMITS_PER_WORKSPACE = 3;
const MAX_RETRY_AFTER_MS = 5_000; // honour Retry-After, but never sleep away the whole night
const UPSERT_CHUNK = 500;
const MAX_LOOPS = 200;

interface QueueRow {
  workspace: string;
  cio_id: string;
  contacted_at: string | null;
  last_pulled_at: string | null;
  last_message_at: string | null;
  attempts: number | null;
}

interface SyncRow {
  workspace: string;
  cio_id: string;
  last_pulled_at: string;
  last_message_at: string | null;
  contacted_at: string | null;
  attempts: number;
  last_error: string | null;
}

interface PullResult {
  row: QueueRow;
  rows: CioMessageRow[];
  newestMessageAt: string | null;
  skipped: number;
  rejectedStamps: number;
  error: string | null;
  rateLimited: boolean;
  pagesCapped: boolean;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    console.error("[cio-message-pull] CRON_SECRET not set — rejecting");
    return NextResponse.json({ error: "Not configured" }, { status: 500 });
  }
  const expected = `Bearer ${cronSecret}`;
  const received = request.headers.get("authorization") || "";
  // Length check first: timingSafeEqual THROWS on a length mismatch rather than returning false.
  if (received.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(received), Buffer.from(expected))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const q = request.nextUrl.searchParams;
  const dry = q.get("dry") === "1";
  const days = Math.max(1, Math.min(365, Number(q.get("days")) || 30));
  const budgetMs = Math.max(5_000, Math.min(290_000, Number(q.get("budgetMs")) || DEFAULT_BUDGET_MS));
  const maxAccounts = Math.max(1, Number(q.get("max")) || Number.MAX_SAFE_INTEGER);

  const startedAt = Date.now();
  const deadline = startedAt + budgetMs;
  const pulledAt = new Date(startedAt).toISOString();

  // A workspace with no App API key is SKIPPED LOUDLY — logged, counted, and named in the
  // response. Never passed over quietly: that is how half a population goes missing unnoticed.
  const configured = new Set(listConfiguredWorkspaces());

  const counts = {
    considered: 0,
    accounts: 0,
    pulled: 0,
    messages: 0,
    upserted: 0,
    skippedNoKey: 0,
    skippedForgottenOrUnkeyable: 0,
    rejectedStamps: 0,
    rateLimited: 0,
    failed: 0,
    pagesCapped: 0,
    // Accounts pulled out of a chunk because their workspace was stopped mid-run. They are left
    // UNSTAMPED on purpose so they lead the queue tomorrow — but without this they vanished from
    // the report entirely, and a run that silently drops work must not read like a clean one.
    droppedWorkspaceStopped: 0,
  };
  const skippedWorkspaces = new Set<string>();
  const stoppedWorkspaces = new Set<string>();
  const rateLimitHits = new Map<string, number>();
  const errors: string[] = [];
  // Every account CONSIDERED this run. The queue re-queries from the top each loop, so without
  // this an account we decline to pull (no key, workspace stopped) would come back forever and
  // the night would be spent going nowhere.
  const seen = new Set<string>();
  let drained = false;
  let noNewRows = false;
  let budgetHit = false;

  for (let loop = 0; loop < MAX_LOOPS; loop++) {
    if (Date.now() >= deadline) { budgetHit = true; break; }
    if (counts.accounts >= maxAccounts) break;

    const { data, error } = await supabaseAdmin.rpc("cio_pull_queue", { p_days: days, p_limit: QUEUE_PAGE });
    if (error) {
      errors.push(`queue: ${error.message}`);
      break;
    }
    const page = (data ?? []) as QueueRow[];
    if (page.length === 0) { drained = true; break; }

    const fresh = page.filter((r) => !seen.has(`${r.workspace}|${r.cio_id}`));
    // Nothing new on this page. Either we have worked the whole head of the queue, or nothing is
    // advancing (dry mode stamps nothing, so this is its normal stopping point). Either way, stop
    // rather than re-request the same rows until the budget runs out.
    if (fresh.length === 0) { noNewRows = true; break; }

    const workable: QueueRow[] = [];
    const parked: SyncRow[] = [];
    for (const row of fresh) {
      if (counts.accounts + workable.length >= maxAccounts) break;
      seen.add(`${row.workspace}|${row.cio_id}`);
      if (!configured.has(row.workspace)) {
        counts.skippedNoKey++;
        skippedWorkspaces.add(row.workspace);
        // Stamped so it sorts to the back and the reason is visible in the table, rather than
        // silently blocking the head of the queue every night.
        parked.push({
          workspace: row.workspace, cio_id: row.cio_id, last_pulled_at: pulledAt,
          last_message_at: row.last_message_at, contacted_at: row.contacted_at,
          attempts: (row.attempts ?? 0) + 1, last_error: "no App API key for this workspace",
        });
        continue;
      }
      if (stoppedWorkspaces.has(row.workspace)) continue; // rate limited tonight; retry tomorrow
      workable.push(row);
    }

    if (parked.length && !dry) await writeSync(parked, errors);

    for (let i = 0; i < workable.length; i += CHUNK) {
      if (Date.now() >= deadline) { budgetHit = true; break; }
      const slice = workable.slice(i, i + CHUNK);
      const chunk = slice.filter((r) => !stoppedWorkspaces.has(r.workspace));
      counts.droppedWorkspaceStopped += slice.length - chunk.length;
      if (chunk.length === 0) continue;

      // Every pullAccount is CAUGHT individually. It is believed not to throw — every I/O path
      // returns a result envelope — but "believed not to throw" is not a guarantee, and the cost
      // of being wrong is not one lost account: Promise.all rejects on the first throw, the whole
      // chunk dies unstamped, and those rows come back at the HEAD of the queue tomorrow night and
      // every night after. One malformed row would wedge the job permanently. Catching turns that
      // into a recorded failure that advances.
      const results = await Promise.all(chunk.map((row) =>
        pullAccount(row, pulledAt, startedAt).catch((e): PullResult => ({
          row, rows: [], newestMessageAt: null, skipped: 0, rejectedStamps: 0,
          error: `unhandled: ${e instanceof Error ? e.message : String(e)}`,
          rateLimited: false, pagesCapped: false,
        })),
      ));

      const messageRows: CioMessageRow[] = [];
      const syncRows: SyncRow[] = [];
      for (const r of results) {
        counts.accounts++;
        counts.messages += r.rows.length;
        counts.skippedForgottenOrUnkeyable += r.skipped;
        counts.rejectedStamps += r.rejectedStamps;
        if (r.pagesCapped) counts.pagesCapped++;
        const workspace = r.row.workspace;
        if (r.rateLimited) {
          counts.rateLimited++;
          const hits = (rateLimitHits.get(workspace) ?? 0) + 1;
          rateLimitHits.set(workspace, hits);
          if (hits >= MAX_RATE_LIMITS_PER_WORKSPACE) {
            stoppedWorkspaces.add(workspace);
            console.error(`[cio-message-pull] ${workspace} stopped for tonight after ${hits} rate limits`);
          }
        }
        if (r.error) {
          counts.failed++;
          if (errors.length < 10) errors.push(`${workspace}/${r.row.cio_id.slice(0, 8)}: ${r.error}`);
        } else {
          counts.pulled++;
        }
        messageRows.push(...r.rows);
        // Stamped on EVERY outcome. An unstamped failure would come back at the head of the
        // queue tomorrow night and every night after.
        syncRows.push({
          workspace,
          cio_id: r.row.cio_id,
          last_pulled_at: pulledAt,
          last_message_at: newerIso(r.row.last_message_at, r.newestMessageAt),
          contacted_at: r.row.contacted_at,
          attempts: r.error ? (r.row.attempts ?? 0) + 1 : 0,
          last_error: r.error,
        });
      }

      if (!dry) {
        const write = await writeMessages(messageRows, errors);
        counts.upserted += write.written;
        // THE WATERMARK ONLY MOVES IF THE MESSAGES LANDED. writeSync used to run unconditionally,
        // so a transient upsert error stamped last_message_at forward with attempts 0 and
        // last_error null — the next night's window then began AFTER the messages that were never
        // written, and that account's CRM history kept a permanent hole while its sync row claimed
        // a clean pull. last_pulled_at still advances (leaving it would wedge the queue head), but
        // the watermark stays put and the failure is recorded.
        await writeSync(
          write.ok ? syncRows : syncRows.map((r) => ({
            ...r,
            last_message_at: results.find((x) => x.row.cio_id === r.cio_id)?.row.last_message_at ?? null,
            attempts: r.attempts + 1,
            last_error: r.last_error ?? "cio_messages upsert failed; watermark held",
          })),
          errors,
        );
      } else {
        counts.upserted += messageRows.length; // what WOULD have been written
      }

      if (moreChunksAfter(i, workable.length)) await sleep(CHUNK_DELAY_MS);
    }
  }

  counts.considered = seen.size;
  const elapsedMs = Date.now() - startedAt;
  const ok = errors.length === 0;
  if (!dry && ok) await recordHeartbeat(supabaseAdmin, CRON_NAMES.cioMessagePull);

  const summary =
    `[cio-message-pull] ${dry ? "DRY " : ""}${days}d accounts=${counts.accounts} pulled=${counts.pulled} ` +
    `messages=${counts.messages} upserted=${counts.upserted} noKey=${counts.skippedNoKey} ` +
    `rateLimited=${counts.rateLimited} dropped=${counts.droppedWorkspaceStopped} failed=${counts.failed} ` +
    `rejectedStamps=${counts.rejectedStamps} ` +
    `${drained ? "drained" : budgetHit ? "BUDGET HIT, carrying over" : noNewRows ? "no new rows" : "stopped"} in ${elapsedMs}ms`;
  console.log(summary);
  if (skippedWorkspaces.size) {
    console.error(`[cio-message-pull] SKIPPED, no App API key: ${[...skippedWorkspaces].join(", ")} ` +
                  `(${counts.skippedNoKey} accounts). These are NOT in cio_messages.`);
  }
  if (counts.rejectedStamps) {
    console.error(`[cio-message-pull] ${counts.rejectedStamps} timestamps rejected as out of range — ` +
                  `check whether Customer.io changed the metrics format.`);
  }

  return NextResponse.json({
    ok,
    dry,
    days,
    elapsedMs,
    drained,
    noNewRows,
    budgetHit,
    workspaces: { configured: [...configured], skippedNoKey: [...skippedWorkspaces], stoppedByRateLimit: [...stoppedWorkspaces] },
    counts,
    errors,
  }, { status: ok ? 200 : 500 });
}

/** 150ms between chunks, but not after the last one — that pause would be pure dead budget. */
function moreChunksAfter(index: number, total: number): boolean {
  return index + CHUNK < total;
}

async function pullAccount(row: QueueRow, pulledAt: string, nowMs: number): Promise<PullResult> {
  const { startTs, endTs } = pullWindow(
    { lastMessageAt: row.last_message_at, contactedAt: row.contacted_at },
    nowMs,
  );
  const rows: CioMessageRow[] = [];
  let newestMessageAt: string | null = null;
  let skipped = 0;
  let rejectedStamps = 0;
  let error: string | null = null;
  let rateLimited = false;
  let pagesCapped = false;
  let start: string | null = null;
  let pages = 0;

  do {
    const page = await fetchCustomerMessages({
      workspace: row.workspace, cioId: row.cio_id, startTs, endTs, start,
    });
    if (page.status === 429) {
      rateLimited = true;
      error = "rate limited";
      if (page.retryAfterMs !== null) await sleep(Math.min(page.retryAfterMs, MAX_RETRY_AFTER_MS));
      break;
    }
    if (!page.ok) { error = page.error; break; }

    for (const message of page.messages) {
      // Same pure function toMessageRow uses, called only to COUNT rejections. A timestamp the
      // range guard refuses is the first sign of a provider format change, and it must surface as
      // a number in the nightly report rather than as quietly empty columns for a month.
      rejectedStamps += deriveTimestamps(message.metrics, nowMs).rejected.length;
      const built = toMessageRow(row.workspace, row.cio_id, message, pulledAt, nowMs);
      if (!built) { skipped++; continue; } // forgotten, or no id to key it by
      rows.push(built);
      newestMessageAt = newerIso(newestMessageAt, built.sent_at ?? built.cio_created_at);
    }

    start = page.next;
    pages++;
    if (pages >= MAX_PAGES_PER_ACCOUNT && start) { pagesCapped = true; break; }
  } while (start);

  return { row, rows, newestMessageAt, skipped, rejectedStamps, error, rateLimited, pagesCapped };
}

/* The awaits in both writers are sequential ON PURPOSE, and react-doctor's await-in-loop warning
 * is declined here: chunks must land one at a time so a failure stops the rest instead of firing
 * every remaining chunk at Supabase anyway, and so the upsert load stays flat. Same for the page
 * loop in pullAccount(), where each request needs the previous response's `next` cursor. */
async function writeMessages(input: CioMessageRow[], errors: string[]): Promise<{ written: number; ok: boolean }> {
  // Postgres refuses an ON CONFLICT statement that touches the same key twice ("cannot affect row
  // a second time") and fails the ENTIRE batch. Overlapping page cursors, or one account appearing
  // under two campaigns, can produce that. Dedupe on the primary key, last write wins.
  const unique = new Map<string, CioMessageRow>();
  for (const row of input) unique.set(`${row.workspace}|${row.message_id}`, row);
  const rows = [...unique.values()];

  let written = 0;
  for (let i = 0; i < rows.length; i += UPSERT_CHUNK) {
    const slice = rows.slice(i, i + UPSERT_CHUNK);
    const { error } = await supabaseAdmin
      .from("cio_messages")
      .upsert(slice, { onConflict: "workspace,message_id" });
    if (error) {
      if (errors.length < 10) errors.push(`cio_messages upsert: ${error.message}`);
      return { written, ok: false };
    }
    written += slice.length;
  }
  return { written, ok: true };
}

async function writeSync(input: SyncRow[], errors: string[]): Promise<void> {
  const unique = new Map<string, SyncRow>();
  for (const row of input) unique.set(`${row.workspace}|${row.cio_id}`, row);
  const rows = [...unique.values()];
  for (let i = 0; i < rows.length; i += UPSERT_CHUNK) {
    const { error } = await supabaseAdmin
      .from("cio_delivery_sync")
      .upsert(rows.slice(i, i + UPSERT_CHUNK), { onConflict: "workspace,cio_id" });
    if (error && errors.length < 10) errors.push(`cio_delivery_sync upsert: ${error.message}`);
  }
}
