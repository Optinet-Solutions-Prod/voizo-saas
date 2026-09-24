import type { ComponentType } from "react";
import type { LucideIcon } from "lucide-react";
import { Phone, Plug, ShieldCheck } from "lucide-react";
import IntegrationsTab from "./IntegrationsTab";
import PhoneNumbersTab from "./PhoneNumbersTab";
import PlatformTab from "./PlatformTab";

// Extra Settings tabs beyond Organization / Members / Brands. Kept in one place so the page's
// tab strip and the URL ?tab= keys stay in sync.
export interface SettingsTab {
  key: string;
  label: string;
  icon: LucideIcon;
  component: ComponentType;
  /** Only VOIZO platform staff (auth app_metadata.role = "admin") see it. */
  platformOnly?: boolean;
}

export const SETTINGS_TABS_EXTRA: SettingsTab[] = [
  { key: "integrations", label: "Integrations", icon: Plug, component: IntegrationsTab },
  { key: "phone-numbers", label: "Phone numbers", icon: Phone, component: PhoneNumbersTab },
  { key: "platform", label: "Platform", icon: ShieldCheck, component: PlatformTab, platformOnly: true },
];
