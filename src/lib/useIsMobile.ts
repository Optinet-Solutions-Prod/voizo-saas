"use client";

import { useSyncExternalStore } from "react";

// True below Tailwind's `md` breakpoint (768px), the width where the console switches from the
// sidebar to the phone top bar + bottom tabs. Hydration-safe: the server snapshot is `false`, so
// server and first client render agree, and phones switch right after hydration with no mismatch.
const QUERY = "(max-width: 767.98px)";

function subscribe(onChange: () => void) {
  const mq = window.matchMedia(QUERY);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

export function useIsMobile(): boolean {
  return useSyncExternalStore(subscribe, () => window.matchMedia(QUERY).matches, () => false);
}
