// How an organization runs its calls and follow-ups. Stored in organizations.settings.delivery_mode.
//   on_the_go — "Agents on the go": VOIZO's numbers, SIP trunk (Squaretalk), SMS and email.
//   own       — "Bring your own": the org's connected carrier/SIP trunk, numbers and senders,
//               with VOIZO's filling in whatever isn't connected.

export type DeliveryMode = "on_the_go" | "own";

export const DELIVERY_MODES: { value: DeliveryMode; label: string; tagline: string; body: string }[] = [
  { value: "on_the_go", label: "Agents on the go", tagline: "Ready as it is, anytime, anywhere.", body: "Your campaigns run on VOIZO's phone numbers, SIP trunk, SMS and email. Nothing to connect." },
  { value: "own", label: "Bring your own", tagline: "Your carrier, your numbers, your senders.", body: "Connect your SIP trunk or carrier, phone numbers, SMS and email providers below. VOIZO uses yours where connected and its own where not." },
];

export function deliveryModeOf(settings: Record<string, unknown> | null | undefined): DeliveryMode {
  return settings?.delivery_mode === "own" ? "own" : "on_the_go";
}
