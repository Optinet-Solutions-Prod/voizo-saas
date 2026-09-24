"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Lock } from "lucide-react";
import AgentGallery, { type GalleryAgent } from "@/components/AgentGallery";
import { SectionTick } from "../../analytics/SectionIsland";
import { useOrg } from "@/lib/orgContext";

// In-app gallery: add a pre-built agent to this organization as a script (+ Playbook scenarios).
export default function AgentTemplatesPage() {
  const org = useOrg();
  const router = useRouter();
  const [agents, setAgents] = useState<GalleryAgent[] | null>(null);
  const [installing, setInstalling] = useState<string | null>(null);
  const [company, setCompany] = useState("");
  const [msg, setMsg] = useState<{ kind: "ok" | "error" | "lock"; text: string } | null>(null);

  const load = useCallback(async () => {
    const r = await fetch("/api/agents", { cache: "no-store" });
    if (r.ok) setAgents(((await r.json()).agents ?? []) as GalleryAgent[]);
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (org.org?.name && !company) setCompany(org.org.name); }, [org.org?.name, company]);

  async function install(a: GalleryAgent) {
    if (a.tier !== "free" && !a.unlocked) {
      setMsg({ kind: "lock", text: `${a.name} is a paid agent ($${a.priceUsd} / €${a.priceEur} one-time, or included in the Pro plan). Contact VOIZO to unlock it for ${org.org?.name ?? "your organization"}.` });
      return;
    }
    setInstalling(a.key); setMsg(null);
    try {
      const r = await fetch("/api/agents/install", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: a.key, company }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "Install failed");
      setMsg({ kind: "ok", text: `${a.name} added as “${j.scriptName}” with ${j.handlerCount} Playbook scenarios. Opening it…` });
      await load();
      setTimeout(() => router.push(`/script-builder?id=${j.scriptId}`), 900);
    } catch (e) {
      setMsg({ kind: "error", text: e instanceof Error ? e.message : "Install failed" });
    } finally {
      setInstalling(null);
    }
  }

  return (
    <div className="p-4 max-w-[1200px] mx-auto w-full grid grid-cols-[minmax(0,1fr)] gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2.5">
            <SectionTick color="#4d90f0" />
            <h1 className="text-lg font-semibold tracking-tight text-[var(--text-1)]">Agent templates</h1>
          </div>
          <p className="mt-1 text-xs text-[var(--text-3)]">Twenty ready-made agents. Adding one creates an editable script in your Script Builder with its Playbook scenarios, voice and persona.</p>
        </div>
        <Link href="/script-builder" className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--bg-card)] px-3 text-xs font-medium text-[var(--text-2)] hover:text-[var(--text-1)]"><ArrowLeft size={13} /> Back to scripts</Link>
      </div>

      <div className="flex flex-col gap-2 rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-4 sm:flex-row sm:items-center">
        <label htmlFor="tpl-company" className="text-sm text-[var(--text-2)] sm:w-64">Your company name (used in the scripts)</label>
        <input id="tpl-company" value={company} onChange={(e) => setCompany(e.target.value)} placeholder="e.g. Acme Marketing" className="h-10 flex-1 rounded-xl border border-[var(--border-2)] bg-[var(--bg-elevated)] px-3.5 text-sm text-[var(--text-1)] outline-none focus:border-[#4d90f0]" />
      </div>

      {msg && (
        <div className={`flex items-start gap-2.5 rounded-xl border px-3.5 py-3 text-sm ${msg.kind === "ok" ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-200" : msg.kind === "lock" ? "border-amber-500/25 bg-amber-500/10 text-amber-200" : "border-red-500/25 bg-red-500/10 text-red-300"}`}>
          {msg.kind === "lock" && <Lock size={16} className="mt-0.5 shrink-0" />}<span>{msg.text}</span>
        </div>
      )}

      {!agents ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-64 animate-pulse rounded-2xl bg-[var(--bg-elevated)]" />)}</div>
      ) : (
        <AgentGallery agents={agents} onInstall={install} installing={installing} />
      )}
    </div>
  );
}
