"use client";

// The signed-in user's organization, role and brands, for client components.
// Loaded once from /api/org; refresh() after anything that changes membership or brands.
// Also feeds the brand catalog used by brandLabel() / the sidebar switcher.

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { setBrandCatalog } from "@/lib/campaignDisplay";

export interface OrgBrand {
  id: string;
  name: string;
  slug: string;
  color: string | null;
}

export interface OrgSummary {
  id: string;
  name: string;
  slug: string;
  plan: string;
}

export interface OrgState {
  /** null while loading, or when signed out. */
  loaded: boolean;
  provisioned: boolean;
  org: OrgSummary | null;
  role: "owner" | "admin" | "member" | null;
  brands: OrgBrand[];
  email: string | null;
  platformAdmin: boolean;
  canManage: boolean;
  refresh: () => Promise<void>;
}

const OrgContext = createContext<OrgState | null>(null);

export function OrgProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<Omit<OrgState, "refresh" | "canManage">>({
    loaded: false, provisioned: false, org: null, role: null, brands: [], email: null, platformAdmin: false,
  });

  const refresh = useCallback(async () => {
    try {
      const r = await fetch("/api/org", { cache: "no-store" });
      if (r.status === 401) { setState((s) => ({ ...s, loaded: true })); return; }
      const j = await r.json();
      // Brand names/slugs for the display helpers: the org's brands when it has any, else the
      // legacy catalog stays in place.
      const brands: OrgBrand[] = j.brands ?? [];
      setBrandCatalog(brands.length ? brands.map((b) => ({ slug: b.slug, name: b.name })) : null);
      setState({
        loaded: true,
        provisioned: !!j.provisioned,
        org: j.org ?? null,
        role: j.role ?? null,
        brands: j.brands ?? [],
        email: j.email ?? null,
        platformAdmin: !!j.platformAdmin,
      });
    } catch {
      setState((s) => ({ ...s, loaded: true }));
    }
  }, []);

  // refresh() awaits the network before it sets state, so this isn't a synchronous
  // set-state-in-effect; the lint rule can't see past the await.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void refresh(); }, [refresh]);

  const value = useMemo<OrgState>(() => ({
    ...state,
    refresh,
    canManage: state.role === "owner" || state.role === "admin",
  }), [state, refresh]);

  return <OrgContext.Provider value={value}>{children}</OrgContext.Provider>;
}

export function useOrg(): OrgState {
  const ctx = useContext(OrgContext);
  if (!ctx) throw new Error("useOrg must be used within OrgProvider");
  return ctx;
}
