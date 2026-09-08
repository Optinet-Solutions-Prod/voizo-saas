// Mobivate's READ side (2026-09-07): the message history and the opt-out list, both plain GETs on
// the same key that sends (MOBIVATE_API_KEY on MOBIVATE_API_HOST, scopes View/Download Message
// History and List Opt-Outs). Docs: https://wiki.mobivatebulksms.com/llms.txt (message-history,
// optouts-management). Nothing here sends or costs; a throw is the only failure signal, the cron
// route decides what a throw means. Paging is asserted against Mobivate's own `matches` / `total`
// so a partial pull can never pass as a complete one.

const PAGE = 5000; // accepted in the 2026-09-07 probe: 5,000 records in one answer, ~10 s

export interface MobivateHistoryRecord {
  id: string;
  reference: string | null;
  status: string;
  price: number | null;
  currency: string | null;
  parts: number | null;
  created_at: string;
  updated_at: string;
}

export interface MobivateOptoutRecord {
  msisdn: string;
  created_on: string | null;
  note: string | null;
  group: string | null;
}

/** "YYYY-MM-DD" of a UTC instant shifted by whole days. Mobivate's date filters are calendar days. */
export function utcDate(ms: number, addDays = 0): string {
  return new Date(ms + addDays * 86_400_000).toISOString().slice(0, 10);
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);

async function getJson(path: string, fetchImpl: typeof fetch): Promise<Record<string, unknown>> {
  const host = process.env.MOBIVATE_API_HOST;
  const key = process.env.MOBIVATE_API_KEY;
  if (!host || !key) throw new Error("MOBIVATE_API_HOST / MOBIVATE_API_KEY not set");
  const res = await fetchImpl(`https://${host}${path}`, {
    headers: { Accept: "application/json", Authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(60_000),
  });
  const text = await res.text();
  let body: Record<string, unknown> = {};
  try { body = JSON.parse(text) as Record<string, unknown>; } catch { /* non-JSON body: reported below */ }
  if (!res.ok) throw new Error(`Mobivate ${res.status} on ${path}: ${str(body.error) ?? str(body.message) ?? text.slice(0, 200)}`);
  return body;
}

/** Every outbound record Mobivate holds for [fromDate, toDate]. Pad toDate by a day: the filter
 *  left out the last UTC hours of the named day in the 2026-09-07 probe. */
export async function fetchMessageHistory(fromDate: string, toDate: string, fetchImpl: typeof fetch = fetch): Promise<MobivateHistoryRecord[]> {
  const out: MobivateHistoryRecord[] = [];
  let expected: number | null = null;
  for (let offset = 0; ; offset += PAGE) {
    const body = await getJson(`/messages/history?fromDate=${fromDate}&toDate=${toDate}&limit=${PAGE}&offset=${offset}`, fetchImpl);
    const results = Array.isArray(body.results) ? (body.results as Record<string, unknown>[]) : null;
    if (!results) throw new Error(`Mobivate history: no results array (keys ${Object.keys(body).join(",")})`);
    if (expected === null) expected = num(body.matches);
    for (const r of results) {
      out.push({
        id: String(r.id ?? ""),
        reference: str(r.reference),
        status: String(r.status ?? "").toUpperCase(),
        price: num(r.price),
        currency: str(r.currency),
        parts: num(r.parts),
        created_at: String(r.created_at ?? ""),
        updated_at: String(r.updated_at ?? ""),
      });
    }
    if (results.length < PAGE) break;
  }
  if (expected !== null && out.length !== expected) throw new Error(`Mobivate history: read ${out.length} of ${expected} records`);
  return out;
}

/** Mobivate's whole opt-out list (STOP replies, the "3x UNDELIVERABLE" rule, CRM pastes). */
export async function fetchOptouts(fetchImpl: typeof fetch = fetch): Promise<MobivateOptoutRecord[]> {
  const out: MobivateOptoutRecord[] = [];
  let expected: number | null = null;
  for (let offset = 0; ; offset += PAGE) {
    const body = await getJson(`/addressbook/optouts?limit=${PAGE}&offset=${offset}`, fetchImpl);
    const records = Array.isArray(body.records) ? (body.records as Record<string, unknown>[]) : null;
    if (!records) throw new Error(`Mobivate optouts: no records array (keys ${Object.keys(body).join(",")})`);
    if (expected === null) expected = num(body.total);
    for (const r of records) out.push({ msisdn: String(r.msisdn ?? ""), created_on: str(r.created_on), note: str(r.note), group: str(r.group) });
    if (records.length < PAGE) break;
  }
  if (expected !== null && out.length !== expected) throw new Error(`Mobivate optouts: read ${out.length} of ${expected} records`);
  return out;
}
