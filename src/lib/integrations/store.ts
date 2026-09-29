import { decryptJson } from "./crypto";
import { deliveryModeOf, type DeliveryMode } from "../deliveryMode";

// Loaded lazily: supabaseServer throws at import time without env, and unit tests reach this
// module through recurringSpawn / rebindCore.
const db = async () => (await import("../supabaseServer")).supabaseService;

// Server-side access to an organization's stored credentials, for the code that USES them
// (cron, webhooks, voice lookups). Reads with the service role because callers often have no
// user session; always pass the org id you resolved from a trusted source.

export interface OrgIntegration<C extends Record<string, string> = Record<string, string>> {
  provider: string;
  credentials: C;
  config: Record<string, string>;
  status: "untested" | "ok" | "failed";
}

export async function getOrgIntegration<C extends Record<string, string> = Record<string, string>>(
  orgId: string,
  provider: string,
): Promise<OrgIntegration<C> | null> {
  const { data, error } = await (await db())
    .from("org_integrations")
    .select("provider, credentials, config, status")
    .eq("org_id", orgId)
    .eq("provider", provider)
    .maybeSingle();
  if (error || !data) return null;
  try {
    return {
      provider: data.provider as string,
      credentials: await decryptJson<C>(data.credentials as string),
      config: (data.config ?? {}) as Record<string, string>,
      status: data.status as OrgIntegration["status"],
    };
  } catch {
    return null;
  }
}

const strip = (o: Record<string, string | undefined>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v)) as Record<string, string>;

/** VOIZO's own services, from platform env — what "Agents on the go" runs on. */
export function platformIntegration(provider: string): OrgIntegration | null {
  const e = process.env;
  const mk = (credentials: Record<string, string | undefined>, config: Record<string, string | undefined>, required: (string | undefined)[]): OrgIntegration | null =>
    required.every(Boolean) ? { provider, credentials: strip(credentials), config: strip(config), status: "ok" } : null;
  switch (provider) {
    case "mobivate": return mk({ apiKey: e.MOBIVATE_API_KEY }, { apiHost: e.MOBIVATE_API_HOST, senderId: e.MOBIVATE_SENDER_ID }, [e.MOBIVATE_API_KEY, e.MOBIVATE_API_HOST]);
    case "resend": return mk({ apiKey: e.RESEND_API_KEY }, { from: e.RESEND_FROM }, [e.RESEND_API_KEY]);
    case "freeswitch": return mk({ shimSecret: e.FREESWITCH_SHIM_SECRET, webhookSecret: e.FREESWITCH_WEBHOOK_SECRET }, { shimUrl: e.FREESWITCH_SHIM_URL, callerId: e.FREESWITCH_CALLER_ID }, [e.FREESWITCH_SHIM_URL, e.FREESWITCH_SHIM_SECRET]);
    case "squaretalk": return mk({ apiKey: e.SQUARETALK_API_KEY }, { baseUrl: e.SQUARETALK_BASE_URL }, [e.SQUARETALK_API_KEY, e.SQUARETALK_BASE_URL]);
    case "siptrunk": return mk({ password: e.PLATFORM_SIP_PASSWORD }, { host: e.PLATFORM_SIP_HOST, port: e.PLATFORM_SIP_PORT ?? "5060", transport: e.PLATFORM_SIP_TRANSPORT ?? "udp", username: e.PLATFORM_SIP_USERNAME, callerId: e.PLATFORM_SIP_CALLER_ID }, [e.PLATFORM_SIP_HOST]);
    case "openai": return mk({ apiKey: e.OPENAI_API_KEY }, {}, [e.OPENAI_API_KEY]);
    default: return null;
  }
}

export async function orgDeliveryMode(orgId: string): Promise<DeliveryMode> {
  const { data } = await (await db()).from("organizations").select("settings").eq("id", orgId).maybeSingle();
  return deliveryModeOf((data?.settings ?? {}) as Record<string, unknown>);
}

/**
 * The integration to USE for an org. "Agents on the go" → VOIZO's; "bring your own" → the org's
 * connected one, with VOIZO's as the fallback where nothing is connected.
 */
export async function resolveIntegration<C extends Record<string, string> = Record<string, string>>(
  orgId: string,
  provider: string,
): Promise<(OrgIntegration<C> & { source: "platform" | "org" }) | null> {
  const mode = await orgDeliveryMode(orgId);
  const platform = platformIntegration(provider) as OrgIntegration<C> | null;
  if (mode === "on_the_go" && platform) return { ...platform, source: "platform" };
  const own = await getOrgIntegration<C>(orgId, provider);
  if (own) return { ...own, source: "org" };
  return platform ? { ...platform, source: "platform" } : null;
}

/** The organization that owns a campaign — how cron/webhook code finds "whose keys". */
export async function orgIdForCampaign(campaignId: string): Promise<string | null> {
  const { data } = await (await db()).from("campaigns_v2").select("org_id").eq("id", campaignId).maybeSingle();
  return (data?.org_id as string | null) ?? null;
}
