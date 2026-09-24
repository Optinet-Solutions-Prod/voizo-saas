// Guided tours (Phase 7, 2026-09-24). Each step points at an element marked with
// data-tour="<target>"; a step whose target isn't on screen (e.g. desktop-only rails on a phone)
// shows centred with no spotlight. Completion is stored per user (see useTours).

export type TourId = "welcome" | "campaign" | "script-builder" | "organization";

export interface TourStep {
  target?: string; // data-tour value
  title: string;
  body: string;
  /** Where the card sits relative to the target. Default: auto (below, else above). */
  placement?: "bottom" | "top" | "left" | "right";
}

export interface TourDef {
  id: TourId;
  name: string;
  /** Path prefix the tour belongs to (auto-starts the first time the user lands there). */
  path: string;
  steps: TourStep[];
}

export const TOURS: Record<TourId, TourDef> = {
  welcome: {
    id: "welcome",
    name: "Welcome tour",
    path: "/dashboard",
    steps: [
      { title: "Welcome to VOIZO", body: "This is your console. In about a minute you'll know where everything lives. You can skip at any time and restart any tour from the ? button." },
      { target: "brand-switcher", title: "Brands", body: "Every campaign belongs to a brand: a product or customer you call for. Switch here to filter the whole console to one brand, or see all of them.", placement: "right" },
      { target: "nav-campaigns", title: "Campaigns", body: "Upload an audience, pick an agent, set calling windows and press start. Recurring and real-time campaigns run themselves.", placement: "right" },
      { target: "nav-script-builder", title: "Script Builder", body: "Design what your agents say as a flow of boxes, or start from one of twenty pre-built agents. Test with a real call before any customer hears it.", placement: "right" },
      { target: "nav-reviews", title: "Reviews & QA", body: "Read transcripts, let the AI judge score calls, and label the ones that matter to improve your scripts.", placement: "right" },
      { target: "account-menu", title: "Settings", body: "Your organization, team members, brands, connected services and phone numbers live under Settings in this menu.", placement: "bottom" },
      { title: "You're set", body: "Start with Script Builder → Agent templates to add a free agent, then create your first campaign. Each of those pages has its own short tour." },
    ],
  },
  campaign: {
    id: "campaign",
    name: "Campaign tour",
    path: "/campaigns/v2/new",
    steps: [
      { target: "wizard-steps", title: "Five steps", body: "Audience, agent, schedule, follow-up, review. Click any step to jump back; nothing dials until you press Launch on the last one.", placement: "bottom" },
      { target: "wizard-form", title: "Audience", body: "Name the campaign, pick its brand, and choose who to call: a Customer.io segment, a saved VOIZO segment, or numbers you paste. VOIZO detects the country and legal calling hours.", placement: "top" },
      { target: "wizard-preview", title: "Live preview", body: "As you fill in each step, this rail shows the campaign taking shape, with an estimate of reach and cost.", placement: "left" },
      { target: "wizard-footer", title: "Continue", body: "Continue is enabled once the required fields are in. The Review step shows everything in one place before you launch.", placement: "top" },
    ],
  },
  "script-builder": {
    id: "script-builder",
    name: "Script Builder tour",
    path: "/script-builder",
    steps: [
      { target: "sb-templates", title: "Start from a template", body: "Twenty pre-built agents: reminders, lead follow-up, payments, surveys and more. Adding one creates an editable script here with its voice and Playbook lines.", placement: "bottom" },
      { target: "sb-new", title: "Or start blank", body: "Give the script a name and you'll land in the editor.", placement: "bottom" },
      { target: "sb-palette", title: "Boxes", body: "Drag boxes onto the canvas: Scenario (something the agent says and the replies it expects), Send SMS, Call Goal, End call.", placement: "right" },
      { target: "sb-canvas", title: "The flow", body: "Connect boxes with arrows. Each green dot on a box is one predicted customer reply; drag it to the box that should come next.", placement: "top" },
      { target: "sb-config", title: "Voice & persona", body: "The cog opens the agent's voice (including your own ElevenLabs voices), persona and listener settings.", placement: "bottom" },
      { target: "sb-run", title: "Test call", body: "The play button checks the script and places a real test call to you, with the canvas lighting up as the conversation moves.", placement: "bottom" },
      { target: "sb-save", title: "Save", body: "Save when you're happy. Campaigns run a frozen copy of the script, so editing later never disturbs a live campaign.", placement: "bottom" },
    ],
  },
  organization: {
    id: "organization",
    name: "Organization tour",
    path: "/settings",
    steps: [
      { target: "settings-tabs", title: "Your organization", body: "Everything about your workspace is here. Only owners and admins can change these; members can look.", placement: "bottom" },
      { target: "tab-members", title: "Members", body: "Invite colleagues by email. Admins manage the organization; members run campaigns and build agents.", placement: "bottom" },
      { target: "tab-brands", title: "Brands", body: "Add a brand for each product or customer you call for. Campaigns, SMS sender IDs and Customer.io workspaces are grouped by brand.", placement: "bottom" },
      { target: "tab-integrations", title: "Integrations", body: "Connect your own Customer.io, OpenAI, Twilio, ElevenLabs and more, and test each connection with one click.", placement: "bottom" },
      { target: "tab-phone-numbers", title: "Phone numbers", body: "Register the caller IDs your campaigns dial from and verify them.", placement: "bottom" },
    ],
  },
};

export const TOUR_ORDER: TourId[] = ["welcome", "campaign", "script-builder", "organization"];

/** The tour that belongs to a path, if any (longest prefix wins). */
export function tourForPath(pathname: string): TourDef | null {
  let best: TourDef | null = null;
  for (const t of Object.values(TOURS)) {
    if (pathname === t.path || pathname.startsWith(t.path + "/") || pathname.startsWith(t.path + "?")) {
      if (!best || t.path.length > best.path.length) best = t;
    }
  }
  // /script-builder?id=… is the editor; the list page is plain /script-builder — same tour.
  return best;
}
