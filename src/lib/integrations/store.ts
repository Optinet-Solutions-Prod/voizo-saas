import { supabaseService } from "@/lib/supabaseServer";
import { decryptJson } from "@/lib/integrations/crypto";

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
  const { data, error } = await supabaseService
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

/** The organization that owns a campaign — how cron/webhook code finds "whose keys". */
export async function orgIdForCampaign(campaignId: string): Promise<string | null> {
  const { data } = await supabaseService.from("campaigns_v2").select("org_id").eq("id", campaignId).maybeSingle();
  return (data?.org_id as string | null) ?? null;
}
