"use client";

import { useEffect, useRef } from "react";

// Cloudflare Turnstile widget (explicit render). Mount with a changing `key` to get a fresh
// token after each use; tokens are single-use on the server.

declare global {
  interface Window {
    turnstile?: {
      render: (el: HTMLElement, opts: Record<string, unknown>) => string;
      remove: (id: string) => void;
      reset: (id: string) => void;
    };
  }
}

let loading: Promise<void> | null = null;
function loadScript(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  if (!loading) {
    loading = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => { loading = null; reject(new Error("Turnstile failed to load")); };
      document.head.appendChild(s);
    });
  }
  return loading;
}

export default function Turnstile({ siteKey, action, onToken }: { siteKey: string; action: string; onToken: (token: string | null) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const idRef = useRef<string | null>(null);
  const cb = useRef(onToken);
  useEffect(() => { cb.current = onToken; });

  useEffect(() => {
    let alive = true;
    loadScript()
      .then(() => {
        if (!alive || !ref.current || !window.turnstile) return;
        idRef.current = window.turnstile.render(ref.current, {
          sitekey: siteKey,
          action,
          theme: "dark",
          size: "flexible",
          callback: (t: string) => cb.current(t),
          "expired-callback": () => cb.current(null),
          "error-callback": () => cb.current(null),
        });
      })
      .catch(() => cb.current(null));
    return () => {
      alive = false;
      if (idRef.current && window.turnstile) { try { window.turnstile.remove(idRef.current); } catch { /* gone */ } }
    };
  }, [siteKey, action]);

  return <div ref={ref} className="min-h-[65px]" />;
}
