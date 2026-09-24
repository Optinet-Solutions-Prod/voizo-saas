"use client";

import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Building2, Palette, Users } from "lucide-react";
import { useOrg } from "@/lib/orgContext";
import { SectionTick } from "../analytics/SectionIsland";
import OrganizationTab from "./OrganizationTab";
import MembersTab from "./MembersTab";
import BrandsTab from "./BrandsTab";
import { SETTINGS_TABS_EXTRA } from "./tabs";

// Settings: the organization (name, members & invites, brands) and, from Phase 3 on, the
// integrations and phone numbers registered in ./tabs.ts. ?tab= keeps the tab in the URL.

const BASE_TABS = [
  { key: "organization", label: "Organization", icon: Building2 },
  { key: "members", label: "Members", icon: Users },
  { key: "brands", label: "Brands", icon: Palette },
] as const;

export default function SettingsPage() {
  return (
    <Suspense fallback={null}>
      <SettingsInner />
    </Suspense>
  );
}

function SettingsInner() {
  const org = useOrg();
  const router = useRouter();
  const params = useSearchParams();
  const tabs = [...BASE_TABS, ...SETTINGS_TABS_EXTRA.filter((t) => !t.platformOnly || org.platformAdmin)];
  const tab = params.get("tab") ?? "organization";
  const setTab = (k: string) => router.replace(`/settings?tab=${k}`);

  if (org.loaded && !org.provisioned) {
    return (
      <div className="p-4 max-w-[1000px] mx-auto w-full grid grid-cols-[minmax(0,1fr)] gap-4">
        <Header />
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-5 text-sm text-amber-200">
          <p className="font-semibold text-amber-300">Organizations aren&apos;t switched on yet</p>
          <p className="mt-1">Run <code className="font-mono text-xs">supabase-migration-saas-tenancy.sql</code> in the Supabase SQL editor once. The console then gets organizations, members, invites and brands, and this page fills in by itself.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 max-w-[1000px] mx-auto w-full grid grid-cols-[minmax(0,1fr)] gap-4">
      <Header />
      <div data-tour="settings-tabs" className="flex w-full sm:w-fit max-w-full overflow-x-auto hide-scrollbar gap-1 p-1 bg-[var(--bg-card)] border border-[var(--border)] rounded-xl">
        {tabs.map(({ key, label, icon: Icon }) => (
          <button key={key} type="button" data-tour={`tab-${key}`} onClick={() => setTab(key)}
            className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-md text-xs font-medium transition whitespace-nowrap ${tab === key ? "bg-[var(--bg-elevated)] text-[var(--text-1)]" : "text-[var(--text-3)] hover:text-[var(--text-1)]"}`}>
            <Icon size={13} /> {label}
          </button>
        ))}
      </div>
      {tab === "organization" && <OrganizationTab />}
      {tab === "members" && <MembersTab />}
      {tab === "brands" && <BrandsTab />}
      {SETTINGS_TABS_EXTRA.filter((t) => !t.platformOnly || org.platformAdmin).map((t) => (tab === t.key ? <t.component key={t.key} /> : null))}
    </div>
  );
}

function Header() {
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-2.5">
        <SectionTick color="#4d90f0" />
        <h1 className="text-lg font-semibold tracking-tight text-[var(--text-1)]">Settings</h1>
      </div>
      <p className="mt-1 text-xs text-[var(--text-3)]">Your organization, the people in it, your brands and connected services.</p>
    </div>
  );
}
