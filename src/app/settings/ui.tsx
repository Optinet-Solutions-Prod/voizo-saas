"use client";

import type { ReactNode } from "react";
import { AlertCircle, CheckCircle2 } from "lucide-react";

// Small shared pieces for the Settings tabs.

export function Card({ title, description, children, action }: { title: string; description?: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="rounded-2xl border border-[var(--border)] bg-[var(--bg-card)]">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--border)] px-5 py-4">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-[var(--text-1)]">{title}</h2>
          {description && <p className="mt-0.5 text-xs text-[var(--text-3)]">{description}</p>}
        </div>
        {action}
      </div>
      <div className="p-5">{children}</div>
    </section>
  );
}

export function Notice({ kind, children }: { kind: "error" | "ok" | "info"; children: ReactNode }) {
  const cls = kind === "error" ? "border-red-500/25 bg-red-500/10 text-red-400" : kind === "ok" ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-300" : "border-[var(--border)] bg-[var(--bg-elevated)] text-[var(--text-2)]";
  const Icon = kind === "ok" ? CheckCircle2 : AlertCircle;
  return (
    <div role={kind === "error" ? "alert" : undefined} className={`flex items-start gap-2.5 rounded-xl border px-3.5 py-3 text-sm ${cls}`}>
      <Icon size={16} className="mt-0.5 shrink-0" /><span className="min-w-0 break-words">{children}</span>
    </div>
  );
}

export const inputCls = "h-10 w-full rounded-xl border border-[var(--border-2)] bg-[var(--bg-elevated)] px-3.5 text-sm text-[var(--text-1)] outline-none placeholder:text-[var(--text-4)] focus:border-[#4d90f0] focus:ring-4 focus:ring-[#4d90f0]/15 disabled:opacity-60";
export const selectCls = "h-10 rounded-xl border border-[var(--border-2)] bg-[var(--bg-elevated)] px-3 text-sm text-[var(--text-1)] outline-none focus:border-[#4d90f0] [color-scheme:dark]";
export const primaryBtn = "inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60";
export const ghostBtn = "inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--bg-card)] px-3 text-xs font-medium text-[var(--text-2)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text-1)] disabled:opacity-50";
export const dangerBtn = "inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-red-500/30 bg-red-500/10 px-3 text-xs font-medium text-red-400 transition hover:bg-red-500/20 disabled:opacity-50";

export function RoleBadge({ role }: { role: string }) {
  const cls = role === "owner" ? "bg-amber-500/15 text-amber-300 border-amber-500/30" : role === "admin" ? "bg-primary/15 text-primary border-primary/30" : "bg-[var(--bg-elevated)] text-[var(--text-2)] border-[var(--border)]";
  return <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium capitalize ${cls}`}>{role}</span>;
}

export async function api<T = unknown>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j as { error?: string }).error ?? `HTTP ${r.status}`);
  return j as T;
}
