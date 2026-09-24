import type { ComponentType } from "react";
import type { LucideIcon } from "lucide-react";

// Extra Settings tabs registered by later phases (integrations, phone numbers).
// Kept in one place so the page's tab strip and the URL ?tab= keys stay in sync.
export interface SettingsTab {
  key: string;
  label: string;
  icon: LucideIcon;
  component: ComponentType;
}

export const SETTINGS_TABS_EXTRA: SettingsTab[] = [];
