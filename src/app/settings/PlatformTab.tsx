"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { Loader2, ShieldCheck, Unlock } from "lucide-react";
import { AGENT_CATALOG } from "@/lib/agents/catalog";
import { PLANS } from "@/lib/pricing";
import { Card, Notice, api, dangerBtn, primaryBtn, selectCls } from "./ui";

// VOIZO staff only (auth app_metadata.role = "admin"): unlock paid agents for any organization
// until card checkout exists. The tab is hidden from everyone else.

interface OrgRow { id: string; name: string; slug: string; plan: string }
interface Purchase { agent_key: string; created_at: string; note: string | null }

export default function PlatformTab() {
  const [orgs, setOrgs] = useState<OrgRow[] | null>(null);
  const [slug, setSlug] = useState("");
  const [agentKey, setAgentKey] = useState(AGENT_CATALOG.find((a) => a.tier === "pro")?.key ?? "");
  const [plan, setPlan] = useState("starter");
  const [purchases, setPurchases] = useState<Purchase[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  useEffect(() => {
    api<{ organizations: OrgRow[] }>("/api/admin/agent-purchases")
      .then((r) => { setOrgs(r.organizations); if (r.organizations[0] && !slug) setSlug(r.organizations[0].slug); })
      .catch((e) => setMsg({ kind: "error", text: e instanceof Error ? e.message : "Could not load organizations" }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadPurchases = useCallback(async (s: string) => {
    if (!s) return;
    try { const r = await api<{ purchases: Purchase[] }>(`/api/admin/agent-purchases?org=${encodeURIComponent(s)}`); setPurchases(r.purchases); }
    catch (e) { setMsg({ kind: "error", text: e instanceof Error ? e.message : "Could not load" }); }
  }, []);
  useEffect(() => { void loadPurchases(slug); }, [slug, loadPurchases]);

  async function setOrgPlan() {
    setBusy("plan"); setMsg(null);
    try {
      await api("/api/admin/org-plan", { method: "PATCH", body: JSON.stringify({ orgSlug: slug, plan }) });
      setMsg({ kind: "ok", text: `${slug} is now on the ${PLANS.find((p) => p.key === plan)?.name ?? plan} plan.` });
      const r = await api<{ organizations: OrgRow[] }>("/api/admin/agent-purchases");
      setOrgs(r.organizations);
    } catch (err) { setMsg({ kind: "error", text: err instanceof Error ? err.message : "Could not change the plan" }); }
    finally { setBusy(null); }
  }

  async function unlock(e: FormEvent) {
    e.preventDefault();
    setBusy("unlock"); setMsg(null);
    try {
      await api("/api/admin/agent-purchases", { method: "POST", body: JSON.stringify({ orgSlug: slug, agentKey }) });
      setMsg({ kind: "ok", text: `Unlocked ${AGENT_CATALOG.find((a) => a.key === agentKey)?.name ?? agentKey} for ${slug}.` });
      await loadPurchases(slug);
    } catch (err) { setMsg({ kind: "error", text: err instanceof Error ? err.message : "Could not unlock" }); }
    finally { setBusy(null); }
  }
  async function revoke(key: string) {
    setBusy(key);
    try { await api(`/api/admin/agent-purchases?org=${encodeURIComponent(slug)}&agent=${encodeURIComponent(key)}`, { method: "DELETE" }); await loadPurchases(slug); }
    catch (err) { setMsg({ kind: "error", text: err instanceof Error ? err.message : "Could not revoke" }); }
    finally { setBusy(null); }
  }

  return (
    <div className="grid gap-4">
      <Notice kind="info"><span className="inline-flex items-center gap-1.5"><ShieldCheck size={14} /> You see this tab because your account is marked as VOIZO platform staff.</span></Notice>
      {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}
      <Card title="Set an organization's plan" description="Pro and Scale include all twenty agents; Free and Starter get the three free ones plus unlocks.">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1">
            <label htmlFor="pl-plan-org" className="mb-1.5 block text-xs font-medium text-[var(--text-2)]">Organization</label>
            <select id="pl-plan-org" value={slug} onChange={(e) => setSlug(e.target.value)} className={`${selectCls} w-full`}>
              {(orgs ?? []).map((o) => <option key={o.id} value={o.slug}>{o.name} ({o.slug}) · {o.plan}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="pl-plan" className="mb-1.5 block text-xs font-medium text-[var(--text-2)]">Plan</label>
            <select id="pl-plan" value={plan} onChange={(e) => setPlan(e.target.value)} className={`${selectCls} w-full sm:w-40`}>
              {PLANS.map((p) => <option key={p.key} value={p.key}>{p.name}</option>)}
            </select>
          </div>
          <button type="button" onClick={setOrgPlan} disabled={!slug || busy === "plan"} className={primaryBtn}>{busy === "plan" ? <Loader2 size={14} className="animate-spin" /> : null} Save plan</button>
        </div>
      </Card>
      <Card title="Unlock a paid agent" description="Grants an organization one of the paid pre-built agents. Free agents never need this.">
        <form onSubmit={unlock} className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1">
            <label htmlFor="pl-org" className="mb-1.5 block text-xs font-medium text-[var(--text-2)]">Organization</label>
            <select id="pl-org" value={slug} onChange={(e) => setSlug(e.target.value)} className={`${selectCls} w-full`}>
              {(orgs ?? []).map((o) => <option key={o.id} value={o.slug}>{o.name} ({o.slug}) · {o.plan}</option>)}
            </select>
          </div>
          <div className="flex-1">
            <label htmlFor="pl-agent" className="mb-1.5 block text-xs font-medium text-[var(--text-2)]">Agent</label>
            <select id="pl-agent" value={agentKey} onChange={(e) => setAgentKey(e.target.value)} className={`${selectCls} w-full`}>
              {AGENT_CATALOG.filter((a) => a.tier === "pro").map((a) => <option key={a.key} value={a.key}>{a.name} — {a.role}</option>)}
            </select>
          </div>
          <button type="submit" disabled={!slug || busy === "unlock"} className={primaryBtn}>{busy === "unlock" ? <Loader2 size={14} className="animate-spin" /> : <Unlock size={15} />} Unlock</button>
        </form>
      </Card>
      <Card title={`Unlocked agents${slug ? ` · ${slug}` : ""}`}>
        {!purchases ? <div className="h-16 animate-pulse rounded-xl bg-[var(--bg-elevated)]" /> : purchases.length === 0 ? (
          <p className="text-sm text-[var(--text-3)]">Only the free agents so far.</p>
        ) : (
          <ul className="divide-y divide-[var(--border)]">
            {purchases.map((p) => {
              const a = AGENT_CATALOG.find((x) => x.key === p.agent_key);
              return (
                <li key={p.agent_key} className="flex flex-wrap items-center gap-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-[var(--text-1)]">{a ? `${a.name} — ${a.role}` : p.agent_key}</p>
                    <p className="text-[11px] text-[var(--text-3)]">Unlocked {new Date(p.created_at).toLocaleDateString()}{p.note ? ` · ${p.note}` : ""}</p>
                  </div>
                  <button type="button" onClick={() => revoke(p.agent_key)} disabled={busy === p.agent_key} className={dangerBtn}>Revoke</button>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
