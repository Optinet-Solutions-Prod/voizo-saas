// The Audience tab's LANE: which campaigns a brand + market scope means, and what a FAMILY in that
// lane is called. One module, two callers (/api/audience/players and /api/audience/reach), so the
// player list and the cards can never disagree about who is in scope or what a family is named.
//
// Lane = the DASHBOARD's rule (Jasiel, 2026-09-07): brandKey on cio_workspace, the country parsed
// from the campaign name by campaignIdsForCountry. The snapshot engine behind /audience/preview
// grouped by FAMILY and read the country from the campaign's timezone instead, which is why it
// said lucky7even|AU texted 3,211 players where this rule says 2,946; the preview is being
// regenerated with this rule so the two surfaces agree.
//
// Family = Campaign Performance's rule (campaignGrouping.ts), the recurring parent, plus the
// mockup's one addition: a HAND-MADE SET. The STEVIC sets are 20 AU and 14 CA one-off campaigns
// named alike with a trailing run tag (L7_AU_STEVIC_PROMPT_RND_20NDFS_300%DEPMATCH_17/07/2026);
// nobody thinks of them as 34 families, and 34 rows named by date is what the dashboard rule alone
// produced here (measured 2026-09-07). Campaign Performance still lists those runs bare. A one-off
// with no run tag stays a family of one. Labels are the Today-row recipe: the family's Campaign
// Performance header, minus the country (the tab states it), minus the brand unless All brands.
import { RUN_TAG, brandKey, brandLabel, campaignGroupHeaderLabels, campaignIdsForCountry, campaignShortLabel, formatCampaign } from "./campaignDisplay";
import type { AttemptTag } from "./dashboardAnalytics";
// Relative on purpose, the same import the players route makes: the helper the Today rows use.
import { playOf } from "../app/analytics/campaignGrouping";

export interface LaneCampaign {
  id: string;
  name: string | null;
  cio_workspace?: string | null;
}

export interface FamilyCampaign extends LaneCampaign {
  parent_campaign_id?: string | null;
  campaign_type?: string | null;
  start_at?: string | null;
}

export function laneCampaignIds(live: LaneCampaign[], brand: string, country: string): Set<string> {
  const byBrand = brand ? live.filter((c) => brandKey(c.cio_workspace) === brand) : live;
  return country ? campaignIdsForCountry(byBrand, country) : new Set(byBrand.map((c) => c.id));
}

/** A hand-made set's stem: the name minus its trailing run tag, or null when there is no tag. */
export function handMadeStem(name: string | null | undefined): string | null {
  const n = name ?? "";
  return RUN_TAG.test(n) ? n.replace(RUN_TAG, "").trim() : null;
}

/** The family a campaign belongs to: a recurring parent is its own family's head, a child joins
 *  its parent's, one-offs named alike with a run tag form a hand-made set, anything else is a
 *  family of one. `p:` keys match campaignGrouping's keyOf. */
export function familyKeyOf(c: FamilyCampaign): string {
  if (c.campaign_type === "recurring") return `p:${c.id}`;
  if (c.parent_campaign_id) return `p:${c.parent_campaign_id}`;
  const stem = handMadeStem(c.name);
  return stem ? `grp:${brandKey(c.cio_workspace)}|${stem}` : `solo:${c.id}`;
}

// A hand-made set is named by its stem as the operators wrote it, minus the L7_ prefix, the market
// token and the underscores: "STEVIC PROMPT RND 20NDFS 300%DEPMATCH". Not the parsed offer, because
// the STEVIC and VOIZO sets share one offer and would collapse into the same words.
const stemLabel = (stem: string) =>
  stem.replace(/^L7[_\s]+/i, "").replace(/(^|[_\s])(AU|CA|NZ|US|GB|UK|PH|FR|PL)(?=[_\s]|$)/i, "$1").replace(/[_\s]+/g, " ").trim();

/**
 * A labeller for campaigns in `live`: family label when the campaign sits in one, else the run
 * named from itself the same way. `brandInView` empty means All brands, so the brand is prefixed.
 *
 * The date stamp goes first: it sat AFTER the brand segment and stopped playOf from stripping the
 * brand ("… · Fortune Play (2026-09-04)"). The date lives on the row's own columns.
 */
export function campaignLabeller(live: FamilyCampaign[], brandInView: string): (campaignId: string) => string {
  const byId = new Map(live.map((c) => [c.id, c]));
  const parentLabels = campaignGroupHeaderLabels(
    live.filter((c) => c.campaign_type === "recurring").map((c) => ({ id: c.id, name: c.name ?? "", brand: c.cio_workspace, startAt: c.start_at ?? null })),
  );
  return (campaignId: string): string => {
    const c = byId.get(campaignId);
    if (!c) return campaignId.slice(0, 8);
    const b = brandLabel(c.cio_workspace);
    const stem = c.campaign_type !== "recurring" && !c.parent_campaign_id ? handMadeStem(c.name) : null;
    if (stem) return brandInView ? stemLabel(stem) : `${b} · ${stemLabel(stem)}`;
    const fam = c.campaign_type === "recurring" ? parentLabels.get(c.id) : c.parent_campaign_id ? parentLabels.get(c.parent_campaign_id) : undefined;
    const short = fam ?? campaignShortLabel(c.name).replace(/\s*\(\d{4}-\d{2}-\d{2}\)\s*$/, "");
    const play = playOf(short, formatCampaign(c.name).country, b) || short;
    return brandInView ? play : `${b} · ${play}`;
  };
}

/** The Audience tab's outcome vocabulary for a call: four words, the mockup's dots. The lean
 *  attempt tag (no transcript) cannot emit silent_pickup, so a dead-air pickup reads "spoke" here
 *  where the transcript path would say "silent"; the records drawer documents the same gap. */
export type Dot = "spoke" | "silent" | "voicemail" | "never";
export const DOT_OF: Record<AttemptTag, Dot> = {
  positive: "spoke", neutral: "spoke", declined: "spoke", agent_timeout: "spoke",
  silent_pickup: "silent", early_hangup: "silent",
  voicemail: "voicemail", unreachable: "never",
};
