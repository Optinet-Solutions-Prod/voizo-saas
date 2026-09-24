"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, CreditCard, Loader2 } from "lucide-react";
import { useOrg } from "@/lib/orgContext";
import { PLAN_BY_KEY, formatMoney } from "@/lib/pricing";
import { Card, Notice, RoleBadge, api, inputCls, primaryBtn } from "./ui";

export default function OrganizationTab() {
  const org = useOrg();
  const [name, setName] = useState(org.org?.name ?? "");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  useEffect(() => { setName(org.org?.name ?? ""); }, [org.org?.name]);

  if (!org.loaded) return <div className="h-40 animate-pulse rounded-2xl bg-[var(--bg-elevated)]" />;
  if (!org.org) return <Notice kind="info">You&apos;re not in an organization yet.</Notice>;

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setMsg(null);
    try {
      await api("/api/org", { method: "PATCH", body: JSON.stringify({ name }) });
      await org.refresh();
      setMsg({ kind: "ok", text: "Organization name saved." });
    } catch (err) {
      setMsg({ kind: "error", text: err instanceof Error ? err.message : "Could not save" });
    } finally {
      setBusy(false);
    }
  }

  const plan = PLAN_BY_KEY[org.org.plan] ?? PLAN_BY_KEY.free;

  return (
    <div className="grid gap-4">
      <Card title="Plan" description="What your organization is on today. Plans are set by VOIZO for now; card self-service is coming."
        action={<Link href="/pricing" className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--bg-card)] px-3 text-xs font-medium text-[var(--text-2)] hover:text-[var(--text-1)]">Compare plans <ArrowRight size={13} /></Link>}>
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary"><CreditCard size={22} /></div>
          <div className="min-w-0 flex-1">
            <p className="text-base font-semibold text-[var(--text-1)]">{plan.name} <span className="ml-1 text-sm font-normal text-[var(--text-3)]">{formatMoney(plan.monthly.USD, "USD")} / {formatMoney(plan.monthly.EUR, "EUR")} per month</span></p>
            <p className="text-xs text-[var(--text-3)]">{plan.includedMinutes.toLocaleString()} minutes included · {plan.users === "unlimited" ? "unlimited" : plan.users} users · {plan.brands === "unlimited" ? "unlimited" : plan.brands} brands · {plan.agents}</p>
          </div>
        </div>
      </Card>
      <Card title="Organization" description="The company or team this console belongs to. Everything you create here is visible only to its members.">
        <form onSubmit={save} className="grid gap-4 sm:max-w-md">
          {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}
          <div>
            <label htmlFor="orgname" className="mb-1.5 block text-xs font-medium text-[var(--text-2)]">Name</label>
            <input id="orgname" value={name} onChange={(e) => setName(e.target.value)} disabled={!org.canManage} minLength={2} maxLength={80} className={inputCls} />
          </div>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-xs">
            <dt className="text-[var(--text-3)]">Workspace ID</dt><dd className="font-mono text-[var(--text-2)] break-all">{org.org.slug}</dd>
            <dt className="text-[var(--text-3)]">Plan</dt><dd className="capitalize text-[var(--text-2)]">{org.org.plan}</dd>
            <dt className="text-[var(--text-3)]">Your role</dt><dd><RoleBadge role={org.role ?? "member"} /></dd>
          </dl>
          {org.canManage ? (
            <button type="submit" disabled={busy || name.trim().length < 2 || name === org.org.name} className={`${primaryBtn} w-fit`}>
              {busy && <Loader2 size={14} className="animate-spin" />} Save
            </button>
          ) : (
            <p className="text-xs text-[var(--text-3)]">Only owners and admins can change organization settings.</p>
          )}
        </form>
      </Card>
    </div>
  );
}
