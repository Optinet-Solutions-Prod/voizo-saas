/**
 * VOZ-479 — what the CRM sent a player.
 *
 * Pure mapping + one fetch for the nightly pull (/api/cron/cio-message-pull). The split matches
 * mobivateReconcile.ts / mobivateRead.ts: everything decidable without a network call lives here
 * as a pure function with tests, and the route only orchestrates.
 *
 * Endpoint: GET /v1/customers/{cio_id}/messages?id_type=cio_id (D1). The App API, Bearer auth,
 * per workspace. /v1/deliveries and /v1/customers/{id}/deliveries 404 on an App key — those are
 * console-only and must not be designed around.
 *
 * Shape verified against 526 live messages on 2026-09-12
 * (scripts/_probe-0912-cio-message-shape.cjs). Two facts from that probe drive this file:
 *   - `recipient` and `customer_identifiers` are present on 100% of responses. The row builder is
 *     an ALLOWLIST for that reason; a spread would ship the player's email into our database.
 *   - There is no `state` field (D2). Status is derived from `metrics`, an epoch-SECONDS map.
 */
import { CIO_BASE_URL, CIO_FETCH_TIMEOUT_MS, resolveAppApiKey } from "./customerio";

/** One message as the API returns it. The index signature is the point: fields we do not name
 *  (recipient, customer_identifiers, customer_id …) arrive anyway and must never be copied. */
export interface CioApiMessage {
  id?: string | null;
  type?: string | null;
  campaign_id?: number | null;
  broadcast_id?: number | null;
  newsletter_id?: number | null;
  msg_template_id?: number | null;
  action_id?: number | null;
  content_id?: number | null;
  subject?: string | null;
  failure_message?: string | null;
  created?: number | null;
  forgotten?: boolean;
  metrics?: Record<string, unknown> | null;
  [key: string]: unknown;
}

export interface CioMessageRow {
  workspace: string;
  cio_id: string;
  message_id: string;
  type: string | null;
  campaign_id: number | null;
  broadcast_id: number | null;
  newsletter_id: number | null;
  msg_template_id: number | null;
  action_id: number | null;
  content_id: number | null;
  subject: string | null;
  metrics: Record<string, number>;
  sent_at: string | null;
  delivered_at: string | null;
  opened_at: string | null;
  human_opened_at: string | null;
  clicked_at: string | null;
  converted_at: string | null;
  failed_at: string | null;
  failure_message: string | null;
  cio_created_at: string | null;
  pulled_at: string;
}

/** Every column toMessageRow writes, and nothing else. The test compares the built row's key set
 *  against this exactly, so the day someone replaces the allowlist with a spread, it goes red. */
export const CIO_MESSAGE_ROW_KEYS = [
  "workspace", "cio_id", "message_id", "type", "campaign_id", "broadcast_id", "newsletter_id",
  "msg_template_id", "action_id", "content_id", "subject", "metrics", "sent_at", "delivered_at",
  "opened_at", "human_opened_at", "clicked_at", "converted_at", "failed_at", "failure_message",
  "cio_created_at", "pulled_at",
] as const;

/** metrics key -> our column. Customer.io's map holds far more (human_opened, prefetch_opened,
 *  undeliverable, unsubscribed, link:<id> …); those stay in the stored jsonb rather than becoming
 *  columns, so a new question needs no migration. */
const DERIVED_STAMPS = {
  sent: "sent_at",
  delivered: "delivered_at",
  opened: "opened_at",
  // `opened` counts MACHINES too. Measured 2026-09-12 over 434 real emails: 69 carry `opened` and
  // only 41 carry `human_opened`, so 28 opens — 41% — never involved a person, and the open rate
  // reads 15.9% instead of 9.4%. Both are stored: machine opens are real deliverability signal,
  // human opens are the engagement number. `clicked` needs no twin — 0 divergence over the same
  // rows — and metrics keeps human_clicked if that ever changes.
  human_opened: "human_opened_at",
  clicked: "clicked_at",
  converted: "converted_at",
  failed: "failed_at",
} as const;

const MIN_EPOCH_S = 946_684_800; // 2000-01-01. Older than this is corruption, not history.
const MAX_AHEAD_S = 366 * 86_400;
const DAY_S = 86_400;

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** A number, or a numeric string. Anything else is NaN and gets rejected upstream. A string is
 *  accepted so that a provider format change degrades to "still works" rather than to "every
 *  timestamp silently null". */
function numeric(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "string" && v.trim() !== "") return Number(v);
  return NaN;
}

/**
 * Epoch SECONDS, or null.
 *
 * The range check is the millisecond guard. Every one of 526 probed values was 10 digits, but the
 * day one arrives in milliseconds, `new Date(1.789e12 * 1000)` is the year 58,000 — a corrupt row
 * that passes every type check and every non-null assertion. An upper bound of now + 1 year turns
 * that into a visible rejection. The lower bound catches epoch 0, which would otherwise date a
 * message to 1970 instead of leaving it unknown.
 */
function toEpochSeconds(v: unknown, nowMs: number): number | null {
  const n = numeric(v);
  if (!Number.isFinite(n)) return null;
  if (n < MIN_EPOCH_S) return null;
  if (n > Math.floor(nowMs / 1000) + MAX_AHEAD_S) return null;
  return Math.trunc(n);
}

const isoFrom = (secs: number) => new Date(secs * 1000).toISOString();

export interface DerivedStamps {
  sent_at: string | null;
  delivered_at: string | null;
  opened_at: string | null;
  human_opened_at: string | null;
  clicked_at: string | null;
  converted_at: string | null;
  failed_at: string | null;
  /** Keys that were PRESENT but unusable. Absent keys are not rejections — they mean the thing
   *  never happened. The job reports this rather than swallowing it, so a provider format change
   *  shows up as a number on the first night instead of as quietly empty columns for a month. */
  rejected: string[];
}

export function deriveTimestamps(
  metrics: Record<string, unknown> | null | undefined,
  nowMs: number = Date.now(),
): DerivedStamps {
  const out: DerivedStamps = {
    sent_at: null, delivered_at: null, opened_at: null, human_opened_at: null,
    clicked_at: null, converted_at: null, failed_at: null, rejected: [],
  };
  if (!isPlainObject(metrics)) return out;
  for (const [key, column] of Object.entries(DERIVED_STAMPS)) {
    if (!(key in metrics)) continue; // absent = never happened
    const secs = toEpochSeconds(metrics[key], nowMs);
    if (secs === null) { out.rejected.push(key); continue; }
    out[column] = isoFrom(secs);
  }
  return out;
}

/**
 * The epoch map, numbers only.
 *
 * Stored whole (D2) so a newly-relevant metric needs no migration — the same reasoning as
 * cio_events.payload. Dropping non-numeric values is a privacy floor, not tidiness: it means no
 * string from Customer.io can reach our database through this field, whatever they add to it.
 *
 * ponytail: a future NON-numeric metric would be dropped silently. Every one of 526 probed values
 * was a number; widen this only when one is not.
 */
export function sanitizeMetrics(metrics: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!isPlainObject(metrics)) return out;
  for (const [key, value] of Object.entries(metrics)) {
    const n = numeric(value);
    if (Number.isFinite(n)) out[key] = n;
  }
  return out;
}

const asString = (v: unknown): string | null => (typeof v === "string" ? v : null);
const asInt = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? Math.trunc(v) : null;

/**
 * One API message -> one row, or null when it must not be stored.
 *
 * Null for two reasons, both counted by the caller rather than ignored:
 *   - `forgotten === true`: Customer.io has been asked to erase this person. Copying their message
 *     history into our database would work against that. 0 of 526 today; the guard costs one line
 *     and the day it matters is the day it really matters.
 *   - no `id`: the primary key is (workspace, message_id). A row with no id cannot be keyed, and
 *     writing a null key is worse than skipping.
 */
export function toMessageRow(
  workspace: string,
  cioId: string,
  message: CioApiMessage,
  pulledAtIso: string,
  nowMs: number = Date.now(),
): CioMessageRow | null {
  if (message?.forgotten === true) return null;
  const messageId = typeof message?.id === "string" ? message.id.trim() : "";
  if (!messageId) return null;

  // `rejected` is diagnostics for the job, not a column, so the six stamps are named one by one
  // below rather than spread. No spread anywhere in this function is the point of it.
  const stamps = deriveTimestamps(message.metrics, nowMs);
  const created = toEpochSeconds(message.created, nowMs);

  // An ALLOWLIST, never a spread. `recipient` and `customer_identifiers` are on 100% of responses.
  return {
    workspace,
    cio_id: cioId,
    message_id: messageId,
    type: asString(message.type),
    campaign_id: asInt(message.campaign_id),
    broadcast_id: asInt(message.broadcast_id),
    newsletter_id: asInt(message.newsletter_id),
    msg_template_id: asInt(message.msg_template_id),
    action_id: asInt(message.action_id),
    content_id: asInt(message.content_id),
    subject: asString(message.subject),
    metrics: sanitizeMetrics(message.metrics),
    sent_at: stamps.sent_at,
    delivered_at: stamps.delivered_at,
    opened_at: stamps.opened_at,
    human_opened_at: stamps.human_opened_at,
    clicked_at: stamps.clicked_at,
    converted_at: stamps.converted_at,
    failed_at: stamps.failed_at,
    failure_message: asString(message.failure_message),
    cio_created_at: created === null ? null : isoFrom(created),
    pulled_at: pulledAtIso,
  };
}

function parseIsoSeconds(iso: string | null | undefined): number | null {
  if (typeof iso !== "string" || iso.trim() === "") return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
}

export interface PullWindow {
  startTs: number;
  endTs: number;
}

/**
 * The window to ask for, in epoch seconds.
 *
 *   already pulled  -> newest message we hold, minus 48 hours. Metrics keep changing after a send
 *                      (tonight's `sent` is tomorrow's `opened`), so every pull re-reads a trailing
 *                      overlap and overwrites.
 *   first pull      -> their first Voizo contact in the window, minus 7 days, so we see the CRM
 *                      activity that PRECEDED our call. That is the whole point of the table.
 *   knows neither   -> 30 days. Never NaN: `start_ts=NaN` is a request that fails or, worse,
 *                      quietly returns nothing.
 */
export function pullWindow(
  sync: { lastMessageAt: string | null; contactedAt: string | null },
  nowMs: number = Date.now(),
): PullWindow {
  const endTs = Math.floor(nowMs / 1000);
  const lastMessage = parseIsoSeconds(sync.lastMessageAt);
  const contacted = parseIsoSeconds(sync.contactedAt);

  let startTs: number;
  if (lastMessage !== null) startTs = lastMessage - 2 * DAY_S;
  else if (contacted !== null) startTs = contacted - 7 * DAY_S;
  else startTs = endTs - 30 * DAY_S;

  // Clock skew, or a stored date from the future. start >= end asks for an empty window and gets
  // zero messages back, which reads exactly like "this player has no CRM activity".
  if (startTs >= endTs) startTs = endTs - 30 * DAY_S;
  return { startTs, endTs };
}

/**
 * The later of two ISO stamps, ignoring anything unparseable.
 *
 * This maintains cio_delivery_sync.last_message_at, which sets the next pull's trailing window.
 * A naive `Date.parse(a) >= Date.parse(b) ? a : b` returns b whenever a is NaN — so one
 * unparseable value would be adopted as the watermark, and every later window would be computed
 * from garbage. Both sides are validated before they are compared.
 */
export function newerIso(a: string | null, b: string | null): string | null {
  const ta = parseIsoSeconds(a);
  const tb = parseIsoSeconds(b);
  if (ta === null) return tb === null ? null : b;
  if (tb === null) return a;
  return ta >= tb ? a : b;
}

export interface CioMessagesPage {
  ok: boolean;
  status: number;
  messages: CioApiMessage[];
  /** Cursor for the next page, or null when the list is complete. */
  next: string | null;
  /** Set only on 429. Milliseconds, from Retry-After when the header is present. */
  retryAfterMs: number | null;
  error: string | null;
}

/**
 * One page of a player's messages.
 *
 * Unlike customerioFetch(), this keeps the HTTP STATUS. The job has to tell a 429 from a 404 from
 * a 500 — back off, skip, or record the error — and a status flattened into an error string would
 * have to be parsed back out, which breaks the day the message format changes.
 *
 * Rate limiting: measured 2026-09-12, this endpoint returns no rate-limit headers at all, so the
 * ceiling is unknown rather than absent. The caller uses the prod-proven policy
 * (chunkedPromiseAll, 8 per chunk, 150ms apart) and treats 429 as expected.
 */
export async function fetchCustomerMessages(params: {
  workspace: string;
  cioId: string;
  startTs: number;
  endTs: number;
  start?: string | null;
  limit?: number;
}): Promise<CioMessagesPage> {
  const fail = (status: number, error: string, retryAfterMs: number | null = null): CioMessagesPage =>
    ({ ok: false, status, messages: [], next: null, retryAfterMs, error });

  const resolved = resolveAppApiKey(params.workspace);
  if (resolved.error !== null || !resolved.key) return fail(0, resolved.error ?? "no App API key");

  const query = new URLSearchParams({
    id_type: "cio_id",
    limit: String(params.limit ?? 100),
    start_ts: String(params.startTs),
    end_ts: String(params.endTs),
  });
  if (params.start) query.set("start", params.start);
  const path = `/v1/customers/${encodeURIComponent(params.cioId)}/messages?${query.toString()}`;

  try {
    const response = await fetch(`${CIO_BASE_URL}${path}`, {
      method: "GET",
      headers: { Accept: "application/json", Authorization: `Bearer ${resolved.key}` },
      cache: "no-store",
      // Node's fetch has no default timeout; without this a stalled connection hangs the whole job.
      signal: AbortSignal.timeout(CIO_FETCH_TIMEOUT_MS),
    });

    if (response.status === 429) {
      const header = response.headers.get("retry-after");
      const seconds = header === null ? NaN : Number(header);
      return fail(429, "rate limited", Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : null);
    }
    if (!response.ok) {
      const body = await response.text();
      return fail(response.status, `Customer.io ${response.status}: ${body.slice(0, 200)}`);
    }

    const data = (await response.json()) as { messages?: unknown; next?: unknown };
    // A 200 whose body is not the shape we expect is a failure of this function's CONTRACT, not an
    // empty inbox — so it reports ok:false. It used to return ok:true with the error set beside an
    // empty array, and the caller checked `error` only under `if (!ok)`: the account was then
    // recorded as pulled, with last_error null and attempts 0, and the run called itself clean.
    // "Callers must not read [] as no CRM activity" only works if [] never arrives on a success.
    const wellFormed = Array.isArray(data.messages);
    return {
      ok: wellFormed,
      status: response.status,
      messages: wellFormed ? (data.messages as CioApiMessage[]) : [],
      next: typeof data.next === "string" && data.next !== "" ? data.next : null,
      retryAfterMs: null,
      error: wellFormed ? null : `HTTP ${response.status} but the body carried no messages array`,
    };
  } catch (err) {
    return fail(0, `Network error: ${err instanceof Error ? err.message : String(err)}`);
  }
}
