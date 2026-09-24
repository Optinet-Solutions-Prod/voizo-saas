"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { CheckCircle2, ExternalLink, Loader2, Plug, PlugZap, XCircle } from "lucide-react";
import { useOrg } from "@/lib/orgContext";
import type { ProviderField } from "@/lib/integrations/providers";
import { Card, Notice, api, dangerBtn, ghostBtn, inputCls, primaryBtn, selectCls } from "./ui";

interface Item {
  provider: string; name: string; category: string; description: string; docsUrl: string;
  fields: ProviderField[]; connected: boolean; config: Record<string, string>; secrets: Record<string, string>;
  status: "untested" | "ok" | "failed"; lastTestedAt: string | null; lastError: string | null;
}

const CATEGORY_LABEL: Record<string, string> = { crm: "CRM & audiences", telephony: "Telephony", ai: "AI", sms: "SMS", email: "Email", voice: "Voices" };

export default function IntegrationsTab() {
  const org = useOrg();
  const [items, setItems] = useState<Item[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const load = useCallback(async () => {
    try { const r = await api<{ integrations: Item[] }>("/api/org/integrations"); setItems(r.integrations); }
    catch (e) { setMsg({ kind: "error", text: e instanceof Error ? e.message : "Could not load integrations" }); }
  }, []);
  // load() awaits the network before setting state — not a synchronous set-state-in-effect.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (org.loaded && org.org) void load(); }, [org.loaded, org.org, load]);

  if (!org.loaded) return <div className="h-40 animate-pulse rounded-2xl bg-[var(--bg-elevated)]" />;
  if (!org.org) return <Notice kind="info">You&apos;re not in an organization yet.</Notice>;
  if (!items) return <div className="h-40 animate-pulse rounded-2xl bg-[var(--bg-elevated)]" />;

  const groups = [...new Set(items.map((i) => i.category))];

  return (
    <div className="grid gap-4">
      {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}
      {!org.canManage && <Notice kind="info">Only owners and admins can connect or change integrations. You can see what&apos;s connected.</Notice>}
      {groups.map((cat) => (
        <Card key={cat} title={CATEGORY_LABEL[cat] ?? cat}>
          <ul className="divide-y divide-[var(--border)]">
            {items.filter((i) => i.category === cat).map((item) => (
              <li key={item.provider} className="py-4 first:pt-0 last:pb-0">
                <ProviderRow item={item} open={open === item.provider} canManage={org.canManage}
                  onToggle={() => setOpen(open === item.provider ? null : item.provider)}
                  onChanged={async (text) => { setMsg(text ? { kind: "ok", text } : null); await load(); }}
                  onError={(text) => setMsg({ kind: "error", text })} />
              </li>
            ))}
          </ul>
        </Card>
      ))}
    </div>
  );
}

function StatusPill({ item }: { item: Item }) {
  if (!item.connected) return <span className="inline-flex items-center gap-1 rounded-full border border-[var(--border)] bg-[var(--bg-elevated)] px-2 py-0.5 text-[11px] text-[var(--text-3)]"><Plug size={11} /> Not connected</span>;
  if (item.status === "ok") return <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[11px] text-emerald-300"><CheckCircle2 size={11} /> Connected</span>;
  if (item.status === "failed") return <span className="inline-flex items-center gap-1 rounded-full border border-red-500/30 bg-red-500/10 px-2 py-0.5 text-[11px] text-red-400"><XCircle size={11} /> Test failed</span>;
  return <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[11px] text-amber-300"><PlugZap size={11} /> Saved, not tested</span>;
}

function ProviderRow({ item, open, canManage, onToggle, onChanged, onError }: {
  item: Item; open: boolean; canManage: boolean; onToggle: () => void; onChanged: (msg: string | null) => Promise<void>; onError: (msg: string) => void;
}) {
  const [values, setValues] = useState<Record<string, string>>(() => ({ ...item.config }));
  const [busy, setBusy] = useState<"save" | "test" | "remove" | null>(null);
  const [test, setTest] = useState<{ ok: boolean; detail: string; facts?: Record<string, string> } | null>(null);
  useEffect(() => { setValues({ ...item.config }); }, [item.config]);

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy("save"); setTest(null);
    try {
      await api("/api/org/integrations", { method: "PUT", body: JSON.stringify({ provider: item.provider, values }) });
      // Test straight away so the operator gets one answer, not two steps.
      const r = await api<{ result: { ok: boolean; detail: string; facts?: Record<string, string> } }>(`/api/org/integrations/${item.provider}`, { method: "POST" });
      setTest(r.result);
      await onChanged(r.result.ok ? `${item.name} connected.` : null);
    } catch (err) { onError(err instanceof Error ? err.message : "Could not save"); }
    finally { setBusy(null); }
  }
  async function runTest() {
    setBusy("test"); setTest(null);
    try {
      const r = await api<{ result: { ok: boolean; detail: string; facts?: Record<string, string> } }>(`/api/org/integrations/${item.provider}`, { method: "POST" });
      setTest(r.result); await onChanged(null);
    } catch (err) { onError(err instanceof Error ? err.message : "Test failed"); }
    finally { setBusy(null); }
  }
  async function remove() {
    if (!confirm(`Disconnect ${item.name}? The stored credentials are deleted.`)) return;
    setBusy("remove");
    try { await api(`/api/org/integrations/${item.provider}`, { method: "DELETE" }); setValues({}); setTest(null); await onChanged(`${item.name} disconnected.`); }
    catch (err) { onError(err instanceof Error ? err.message : "Could not disconnect"); }
    finally { setBusy(null); }
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold text-[var(--text-1)]">{item.name}</p>
            <StatusPill item={item} />
          </div>
          <p className="mt-0.5 text-xs text-[var(--text-3)]">{item.description}</p>
          {item.connected && item.status === "failed" && item.lastError && <p className="mt-1 text-xs text-red-400">{item.lastError}</p>}
        </div>
        <div className="flex items-center gap-2">
          {item.connected && canManage && <button type="button" onClick={runTest} disabled={busy !== null} className={ghostBtn}>{busy === "test" ? <Loader2 size={13} className="animate-spin" /> : <PlugZap size={13} />} Test</button>}
          {canManage && <button type="button" onClick={onToggle} className={item.connected ? ghostBtn : `${primaryBtn} h-9 px-3 text-xs`}>{open ? "Close" : item.connected ? "Edit" : "Connect"}</button>}
        </div>
      </div>

      {test && (
        <div className={`mt-3 rounded-xl border px-3.5 py-2.5 text-sm ${test.ok ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-200" : "border-red-500/25 bg-red-500/10 text-red-300"}`}>
          <p>{test.detail}</p>
          {test.facts && Object.entries(test.facts).filter(([, v]) => v).length > 0 && (
            <dl className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5 text-xs opacity-80">
              {Object.entries(test.facts).filter(([, v]) => v).map(([k, v]) => <div key={k}><dt className="inline capitalize">{k.replace(/([A-Z])/g, " $1").toLowerCase()}: </dt><dd className="inline font-mono">{v}</dd></div>)}
            </dl>
          )}
        </div>
      )}

      {open && canManage && (
        <form onSubmit={save} className="mt-4 grid gap-3 rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] p-4 sm:grid-cols-2">
          {item.fields.map((f) => (
            <div key={f.key} className={f.type === "select" ? "" : "sm:col-span-2"}>
              <label htmlFor={`${item.provider}-${f.key}`} className="mb-1.5 block text-xs font-medium text-[var(--text-2)]">{f.label}{f.required && <span className="text-red-400"> *</span>}</label>
              {f.type === "select" ? (
                <select id={`${item.provider}-${f.key}`} value={values[f.key] ?? f.options?.[0]?.value ?? ""} onChange={(e) => setValues({ ...values, [f.key]: e.target.value })} className={`${selectCls} w-full`}>
                  {f.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              ) : (
                <input id={`${item.provider}-${f.key}`} type={f.type === "secret" ? "password" : "text"} autoComplete="off"
                  value={values[f.key] ?? ""} onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
                  placeholder={f.type === "secret" && item.secrets[f.key] ? `${item.secrets[f.key]} (leave blank to keep)` : f.placeholder}
                  className={`${inputCls} bg-[var(--bg-card)]`} />
              )}
              {f.help && <p className="mt-1 text-[11px] text-[var(--text-4)]">{f.help}</p>}
            </div>
          ))}
          <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
            <button type="submit" disabled={busy !== null} className={primaryBtn}>{busy === "save" ? <Loader2 size={14} className="animate-spin" /> : <PlugZap size={15} />} Save &amp; test</button>
            {item.connected && <button type="button" onClick={remove} disabled={busy !== null} className={dangerBtn}>Disconnect</button>}
            <a href={item.docsUrl} target="_blank" rel="noreferrer" className="ml-auto inline-flex items-center gap-1 text-xs text-[var(--text-3)] hover:text-[var(--text-1)]">Where to find these <ExternalLink size={12} /></a>
          </div>
        </form>
      )}
    </div>
  );
}
