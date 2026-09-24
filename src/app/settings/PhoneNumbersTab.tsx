"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { CheckCircle2, Loader2, Phone, PhoneCall, Trash2, XCircle } from "lucide-react";
import { useOrg } from "@/lib/orgContext";
import { NUMBER_PROVIDERS } from "@/lib/phoneNumbers";
import { Card, Notice, api, dangerBtn, ghostBtn, inputCls, primaryBtn, selectCls } from "./ui";

interface Num { id: string; e164: string; label: string | null; provider: string; country: string | null; brand_slug: string | null; status: "untested" | "ok" | "failed"; last_tested_at: string | null; last_error: string | null }

export default function PhoneNumbersTab() {
  const org = useOrg();
  const [numbers, setNumbers] = useState<Num[] | null>(null);
  const [e164, setE164] = useState("");
  const [label, setLabel] = useState("");
  const [provider, setProvider] = useState<string>("twilio");
  const [brand, setBrand] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [results, setResults] = useState<Record<string, { ok: boolean; detail: string }>>({});

  const load = useCallback(async () => {
    try { const r = await api<{ numbers: Num[] }>("/api/org/phone-numbers"); setNumbers(r.numbers); }
    catch (e) { setMsg({ kind: "error", text: e instanceof Error ? e.message : "Could not load numbers" }); }
  }, []);
  useEffect(() => { if (org.loaded && org.org) void load(); }, [org.loaded, org.org, load]);

  if (!org.loaded) return <div className="h-40 animate-pulse rounded-2xl bg-[var(--bg-elevated)]" />;
  if (!org.org) return <Notice kind="info">You&apos;re not in an organization yet.</Notice>;

  async function add(e: FormEvent) {
    e.preventDefault();
    setBusy("add"); setMsg(null);
    try {
      const r = await api<{ number: Num }>("/api/org/phone-numbers", { method: "POST", body: JSON.stringify({ e164, label, provider, brandSlug: brand || null }) });
      setE164(""); setLabel("");
      await load();
      await test(r.number.id);
    } catch (err) { setMsg({ kind: "error", text: err instanceof Error ? err.message : "Could not add the number" }); }
    finally { setBusy(null); }
  }
  async function test(id: string) {
    setBusy(id);
    try {
      const r = await api<{ result: { ok: boolean; detail: string } }>(`/api/org/phone-numbers/${id}`, { method: "POST" });
      setResults((m) => ({ ...m, [id]: r.result })); await load();
    } catch (err) { setMsg({ kind: "error", text: err instanceof Error ? err.message : "Test failed" }); }
    finally { setBusy(null); }
  }
  async function remove(n: Num) {
    if (!confirm(`Remove ${n.e164}?`)) return;
    setBusy(n.id);
    try { await api(`/api/org/phone-numbers/${n.id}`, { method: "DELETE" }); await load(); }
    catch (err) { setMsg({ kind: "error", text: err instanceof Error ? err.message : "Could not remove" }); }
    finally { setBusy(null); }
  }

  return (
    <div className="grid gap-4">
      {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}
      {org.canManage && (
        <Card title="Add a phone number" description="The caller IDs your campaigns dial from. Numbers on a connected Twilio account are verified automatically; for other carriers the format is checked and a live test call comes with the dialing phase.">
          <form onSubmit={add} className="grid gap-3 sm:grid-cols-[1.2fr_1fr_1fr_auto] sm:items-end">
            <div>
              <label htmlFor="pn-e164" className="mb-1.5 block text-xs font-medium text-[var(--text-2)]">Number (international)</label>
              <input id="pn-e164" required value={e164} onChange={(e) => setE164(e.target.value)} placeholder="+442036953434" className={inputCls} />
            </div>
            <div>
              <label htmlFor="pn-label" className="mb-1.5 block text-xs font-medium text-[var(--text-2)]">Label</label>
              <input id="pn-label" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="UK main line" className={inputCls} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label htmlFor="pn-provider" className="mb-1.5 block text-xs font-medium text-[var(--text-2)]">Carrier</label>
                <select id="pn-provider" value={provider} onChange={(e) => setProvider(e.target.value)} className={`${selectCls} w-full`}>
                  {NUMBER_PROVIDERS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor="pn-brand" className="mb-1.5 block text-xs font-medium text-[var(--text-2)]">Brand</label>
                <select id="pn-brand" value={brand} onChange={(e) => setBrand(e.target.value)} className={`${selectCls} w-full`}>
                  <option value="">Any</option>
                  {org.brands.map((b) => <option key={b.id} value={b.slug}>{b.name}</option>)}
                </select>
              </div>
            </div>
            <button type="submit" disabled={busy === "add" || !e164} className={primaryBtn}>{busy === "add" ? <Loader2 size={14} className="animate-spin" /> : <Phone size={15} />} Add &amp; test</button>
          </form>
        </Card>
      )}

      <Card title="Phone numbers" description={numbers ? `${numbers.length} registered` : undefined}>
        {!numbers ? <div className="h-24 animate-pulse rounded-xl bg-[var(--bg-elevated)]" /> : numbers.length === 0 ? (
          <div className="flex flex-col items-center py-8 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary"><Phone size={22} /></span>
            <p className="mt-3 text-sm font-medium text-[var(--text-1)]">No numbers yet</p>
            <p className="mt-1 max-w-sm text-xs text-[var(--text-3)]">Add the numbers your campaigns should show as caller ID.</p>
          </div>
        ) : (
          <ul className="divide-y divide-[var(--border)]">
            {numbers.map((n) => {
              const res = results[n.id];
              return (
                <li key={n.id} className="py-3">
                  <div className="flex flex-wrap items-center gap-3">
                    <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${n.status === "ok" ? "bg-emerald-500/10 text-emerald-400" : n.status === "failed" ? "bg-red-500/10 text-red-400" : "bg-[var(--bg-elevated)] text-[var(--text-3)]"}`}>
                      {n.status === "ok" ? <CheckCircle2 size={16} /> : n.status === "failed" ? <XCircle size={16} /> : <Phone size={16} />}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="font-mono text-sm font-medium text-[var(--text-1)]">{n.e164}{n.label && <span className="ml-2 font-sans text-xs text-[var(--text-3)]">{n.label}</span>}</p>
                      <p className="text-[11px] text-[var(--text-3)]">{NUMBER_PROVIDERS.find((p) => p.value === n.provider)?.label ?? n.provider}{n.country ? ` · ${n.country}` : ""}{n.brand_slug ? ` · ${org.brands.find((b) => b.slug === n.brand_slug)?.name ?? n.brand_slug}` : ""}{n.last_tested_at ? ` · tested ${new Date(n.last_tested_at).toLocaleDateString()}` : ""}</p>
                      {(res?.detail ?? (n.status === "failed" ? n.last_error : null)) && <p className={`mt-1 text-xs ${(res?.ok ?? n.status === "ok") ? "text-emerald-300" : "text-red-400"}`}>{res?.detail ?? n.last_error}</p>}
                    </div>
                    {org.canManage && (
                      <div className="flex items-center gap-2">
                        <button type="button" onClick={() => test(n.id)} disabled={busy !== null} className={ghostBtn}>{busy === n.id ? <Loader2 size={13} className="animate-spin" /> : <PhoneCall size={13} />} Test</button>
                        <button type="button" onClick={() => remove(n)} disabled={busy !== null} className={dangerBtn} title="Remove"><Trash2 size={13} /></button>
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
