"use client";

// Account dropdown for the global top bar: the signed-in user (Supabase Auth), Settings, the theme
// toggle and Sign out. Profile is still a stub. Folding the theme toggle in here is what lets the
// top bar stay uncluttered.

import { useRef, useState, useEffect } from "react";
import Link from "next/link";
import { User, Settings, LogOut, Sun, Moon } from "lucide-react";
import { useTheme } from "@/lib/themeContext";
import { supabaseAuthBrowser } from "@/lib/supabaseAuthBrowser";

export default function AccountMenu() {
  const { isDark, toggle } = useTheme();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    supabaseAuthBrowser()
      .auth.getUser()
      .then(({ data }) => {
        if (!cancelled) setEmail(data.user?.email ?? null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function signOut() {
    setSigningOut(true);
    await supabaseAuthBrowser().auth.signOut();
    // Full navigation so no signed-in server state survives in the router cache.
    window.location.assign("/login");
  }

  const initial = (email?.[0] ?? "V").toUpperCase();

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const itemCls = "flex items-center gap-2.5 w-full px-3 py-2 text-xs text-left transition-colors";

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label="Account menu"
        aria-expanded={open}
        className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center cursor-pointer ring-2 ring-transparent hover:ring-blue-500/30 transition"
      >
        <span className="text-white text-[10px] font-bold">{initial}</span>
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 z-50 w-52 bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl shadow-2xl overflow-hidden py-1">
          <div className="px-3 py-2.5 border-b border-[var(--border)]">
            <p className="text-xs font-semibold text-[var(--text-1)] truncate" title={email ?? undefined}>{email ?? "Signed in"}</p>
            <p className="text-[10px] text-[var(--text-3)] mt-0.5">Admin</p>
          </div>

          <button type="button" disabled title="Profile (coming soon)" className={`${itemCls} text-[var(--text-3)] cursor-not-allowed`}>
            <User size={13} /> Profile
          </button>

          <Link href="/settings" onClick={() => setOpen(false)} className={`${itemCls} text-[var(--text-2)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-1)]`}>
            <Settings size={13} /> Settings
          </Link>

          <button type="button" onClick={toggle} className={`${itemCls} justify-between text-[var(--text-2)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-1)]`}>
            <span className="flex items-center gap-2.5">{isDark ? <Moon size={13} /> : <Sun size={13} />} Theme</span>
            <span className="text-[10px] text-[var(--text-3)] uppercase tracking-wide">{isDark ? "Dark" : "Light"}</span>
          </button>

          <div className="border-t border-[var(--border)] mt-1 pt-1">
            <button type="button" onClick={signOut} disabled={signingOut} className={`${itemCls} text-[var(--text-2)] hover:bg-[var(--bg-hover)] hover:text-red-400 disabled:opacity-60`}>
              <LogOut size={13} /> {signingOut ? "Signing out…" : "Sign out"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
