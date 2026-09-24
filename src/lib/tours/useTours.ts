"use client";

import { useCallback, useEffect, useState } from "react";
import { supabaseAuthBrowser } from "@/lib/supabaseAuthBrowser";
import type { TourId } from "./tours";

// Which tours the signed-in user has finished or skipped. Kept in two places: localStorage
// (instant, per browser) and auth user_metadata.tours (follows the user across devices).

const KEY = "voizo-tours";
type Done = Partial<Record<TourId, "done" | "skipped">>;

function readLocal(): Done {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}") as Done;
  } catch {
    return {};
  }
}

let remoteLoaded = false;

export function useTours() {
  // Lazy init from localStorage (client); the server renders with null and nothing in the
  // markup depends on it, so there is no hydration mismatch.
  const [done, setDone] = useState<Done | null>(() => (typeof window === "undefined" ? null : readLocal()));

  useEffect(() => {
    let alive = true;
    if (remoteLoaded) return;
    remoteLoaded = true;
    supabaseAuthBrowser().auth.getUser().then(({ data }) => {
      if (!alive) return;
      const remote = (data.user?.user_metadata?.tours ?? {}) as Done;
      const merged = { ...remote, ...readLocal() };
      try { localStorage.setItem(KEY, JSON.stringify(merged)); } catch { /* ignore */ }
      setDone(merged);
    }).catch(() => {});
    return () => { alive = false; };
  }, []);

  const mark = useCallback(async (id: TourId, how: "done" | "skipped") => {
    const next = { ...readLocal(), [id]: how };
    try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* ignore */ }
    setDone(next);
    try { await supabaseAuthBrowser().auth.updateUser({ data: { tours: next } }); } catch { /* offline: local copy still holds */ }
  }, []);

  const reset = useCallback(async (id?: TourId) => {
    const cur = readLocal();
    const next: Done = id ? { ...cur, [id]: undefined } : {};
    if (id) delete next[id];
    try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* ignore */ }
    setDone(next);
    try { await supabaseAuthBrowser().auth.updateUser({ data: { tours: next } }); } catch { /* ignore */ }
  }, []);

  return { done, loaded: done !== null, mark, reset };
}
