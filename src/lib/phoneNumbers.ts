// Phone number helpers shared by the API and the Settings tab.

/** Strict E.164: "+" then 8–15 digits, no leading zero. */
export function isE164(value: string): boolean {
  return /^\+[1-9]\d{7,14}$/.test(value);
}

/** "0044 20 3695 3434" / "+44 (0)20 3695 3434" → "+442036953434" where possible. */
export function normalizeE164(input: string): string {
  // "(0)" is a trunk-prefix hint in local notation ("+44 (0)20 …"): drop it before the rest.
  let s = input.replace(/\(0\)/g, "").replace(/[\s().-]/g, "");
  if (s.startsWith("00")) s = "+" + s.slice(2);
  s = s.replace(/^\+0+/, "+");
  return s;
}

export const NUMBER_PROVIDERS = [
  { value: "twilio", label: "Twilio" },
  { value: "squaretalk", label: "Squaretalk" },
  { value: "freeswitch", label: "FreeSWITCH / SIP trunk" },
  { value: "vapi", label: "Vapi number" },
  { value: "other", label: "Other carrier" },
] as const;

export type NumberProvider = (typeof NUMBER_PROVIDERS)[number]["value"];
