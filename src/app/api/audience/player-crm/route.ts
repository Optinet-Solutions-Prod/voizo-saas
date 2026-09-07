import { NextRequest, NextResponse } from "next/server";
import { extractNameFromAttrs, getCustomerAttributes, resolveAppApiKey } from "@/lib/customerio";

/**
 * GET /api/audience/player-crm?workspace=&cio=
 *
 * ONE contacted player's Customer.io footprint, read live from the App API when their drawer opens
 * (Jasiel 2026-09-07: "visibility on every CRM message sent to that player, track their event
 * behaviour"). Two calls, both verified 2026-09-03:
 *   /v1/customers/{cio_id}/messages?id_type=cio_id    the messages CIO sent them (email, in_app, push,
 *                                                     sms, webhook) with the metrics timestamps
 *   /v1/activities?customer_id=…&type=event           the events on their profile (login, bonus,
 *                                                     deposit, …), a rolling ~30-day window
 *
 * Scope discipline (CLAUDE.md, Customer.io): read-only, one player who Voizo contacted, on demand.
 * Never forward `recipient`, `customer_identifiers` or an event's `data` (the CRM's email/phone and
 * payment details live there); the console already shows the phone we dialled. Opens and clicks are
 * HUMAN opens/clicks only: machine opens (mail scanners) never enter a number.
 *
 * Cost: zero to Voizo (Customer.io API reads, budget ~10 req/s per key). Nothing near a dial or a text.
 */
const CIO_BASE = "https://api-eu.customer.io";
const TIMEOUT_MS = 8_000;

export interface CrmMessage {
  id: string;
  type: string;
  /** The message's subject or name, as the CRM labels it; "" when it has none. */
  name: string;
  /** Epoch seconds → ISO. Present when the metric happened. */
  createdAt: string | null;
  sentAt: string | null;
  deliveredAt: string | null;
  openedAt: string | null;
  clickedAt: string | null;
  failedAt: string | null;
}
export interface CrmEvent {
  name: string;
  at: string;
}
export interface CrmProfile {
  /** The CRM's name and email for this identity, so a row on the tab can be found in Customer.io
   *  (Jasiel 2026-09-07: the phone alone does not find a profile there). Shown behind Basic Auth,
   *  the console's standing decision on player identity (2026-09-02); never stored by Voizo. */
  name: string | null;
  email: string | null;
}
export interface PlayerCrmResponse {
  workspace: string;
  cioId: string;
  profile: CrmProfile | null;
  messages: CrmMessage[];
  events: CrmEvent[];
  pulledAt: string;
  /** What the CRM refused or timed out on, so the drawer can say "not pulled" instead of "none". */
  unavailable: { messages?: string; events?: string; profile?: string };
}

const iso = (epoch: unknown): string | null => (typeof epoch === "number" && Number.isFinite(epoch) && epoch > 0 ? new Date(epoch * 1000).toISOString() : null);

async function cio<T>(path: string, key: string): Promise<T> {
  const res = await fetch(`${CIO_BASE}${path}`, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(TIMEOUT_MS), cache: "no-store" });
  if (!res.ok) throw new Error(`Customer.io ${res.status}`);
  return (await res.json()) as T;
}

export async function GET(request: NextRequest) {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  if (origin && host) {
    try {
      if (new URL(origin).host !== host) return NextResponse.json({ error: "Forbidden — cross-origin" }, { status: 403 });
    } catch {
      return NextResponse.json({ error: "Forbidden — invalid origin" }, { status: 403 });
    }
  }
  const sp = new URL(request.url).searchParams;
  const workspace = (sp.get("workspace") ?? "").trim().toLowerCase().slice(0, 40);
  const cioId = (sp.get("cio") ?? "").trim();
  if (!workspace || !/^[A-Za-z0-9_-]{6,64}$/.test(cioId)) return NextResponse.json({ error: "workspace and cio are required" }, { status: 400 });
  const { key, error } = resolveAppApiKey(workspace);
  if (!key) return NextResponse.json({ error }, { status: 503 });
  const id = encodeURIComponent(cioId);

  const out: PlayerCrmResponse = { workspace, cioId, profile: null, messages: [], events: [], pulledAt: new Date().toISOString(), unavailable: {} };
  const [m, a, pr] = await Promise.allSettled([
    cio<{ messages?: Record<string, unknown>[] }>(`/v1/customers/${id}/messages?id_type=cio_id&limit=100`, key),
    cio<{ activities?: Record<string, unknown>[] }>(`/v1/activities?customer_id=${id}&id_type=cio_id&type=event&limit=100`, key),
    getCustomerAttributes(cioId, "cio_id", workspace),
  ]);
  if (pr.status === "fulfilled" && pr.value.success) {
    out.profile = { name: extractNameFromAttrs(pr.value.data.attributes), email: pr.value.data.email ?? null };
  } else out.unavailable.profile = pr.status === "fulfilled" ? String(pr.value.error ?? "profile not readable") : pr.reason instanceof Error ? pr.reason.message : String(pr.reason);
  if (m.status === "fulfilled") {
    // `webhook` deliveries are Customer.io calling US (the deposit ingress), not a message the player
    // ever saw; counting them as CRM messages would inflate every number in the drawer.
    out.messages = (m.value.messages ?? []).filter((x) => String(x.type ?? "") !== "webhook").map((x) => {
      const metrics = (x.metrics ?? {}) as Record<string, unknown>;
      return {
        id: String(x.id ?? ""),
        type: String(x.type ?? ""),
        name: String(x.subject ?? x.name ?? ""),
        createdAt: iso(x.created),
        sentAt: iso(metrics.sent),
        deliveredAt: iso(metrics.delivered),
        openedAt: iso(metrics.human_opened),
        clickedAt: iso(metrics.human_clicked),
        failedAt: iso(metrics.failed ?? metrics.bounced),
      };
    }).sort((p, q) => ((p.createdAt ?? "") < (q.createdAt ?? "") ? 1 : -1));
  } else out.unavailable.messages = m.reason instanceof Error ? m.reason.message : String(m.reason);
  if (a.status === "fulfilled") {
    out.events = (a.value.activities ?? [])
      .map((x) => ({ name: String(x.name ?? ""), at: iso(x.timestamp) ?? "" }))
      .filter((e) => e.name && e.at)
      .sort((p, q) => (p.at < q.at ? 1 : -1));
  } else out.unavailable.events = a.reason instanceof Error ? a.reason.message : String(a.reason);
  return NextResponse.json(out);
}
