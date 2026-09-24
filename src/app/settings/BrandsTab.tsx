"use client";

import { FormEvent, useState } from "react";
import { Loader2, Palette, Pencil, Plus, Trash2, X } from "lucide-react";
import { useOrg, type OrgBrand } from "@/lib/orgContext";
import { brandGlyph } from "@/lib/campaignDisplay";
import { Card, Notice, api, dangerBtn, ghostBtn, inputCls, primaryBtn } from "./ui";

const SWATCHES = ["#4d90f0", "#2fb673", "#8b6cf0", "#f0a04d", "#e46fa5", "#22b8a7", "#e0b23c", "#7d828c"];

// Brands: the labels campaigns, SMS senders and Customer.io workspaces are grouped by.
// The sidebar switcher lists these; a campaign's brand is stored as the brand's slug.
export default function BrandsTab() {
  const org = useOrg();
  const [name, setName] = useState("");
  const [color, setColor] = useState(SWATCHES[0]);
  const [editing, setEditing] = useState<OrgBrand | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  if (!org.loaded) return <div className="h-40 animate-pulse rounded-2xl bg-[var(--bg-elevated)]" />;
  if (!org.org) return <Notice kind="info">You&apos;re not in an organization yet.</Notice>;

  async function add(e: FormEvent) {
    e.preventDefault();
    setBusy("add"); setMsg(null);
    try {
      await api("/api/org/brands", { method: "POST", body: JSON.stringify({ name, color }) });
      setName("");
      await org.refresh();
      setMsg({ kind: "ok", text: "Brand added. It now appears in the brand switcher." });
    } catch (err) {
      setMsg({ kind: "error", text: err instanceof Error ? err.message : "Could not add the brand" });
    } finally {
      setBusy(null);
    }
  }

  async function saveEdit(e: FormEvent) {
    e.preventDefault();
    if (!editing) return;
    setBusy(editing.id); setMsg(null);
    try {
      await api(`/api/org/brands/${editing.id}`, { method: "PATCH", body: JSON.stringify({ name: editing.name, color: editing.color }) });
      setEditing(null);
      await org.refresh();
    } catch (err) {
      setMsg({ kind: "error", text: err instanceof Error ? err.message : "Could not save the brand" });
    } finally {
      setBusy(null);
    }
  }

  async function remove(b: OrgBrand) {
    if (!confirm(`Delete the brand "${b.name}"? Campaigns already labelled with it keep their label.`)) return;
    setBusy(b.id); setMsg(null);
    try { await api(`/api/org/brands/${b.id}`, { method: "DELETE" }); await org.refresh(); }
    catch (err) { setMsg({ kind: "error", text: err instanceof Error ? err.message : "Could not delete the brand" }); }
    finally { setBusy(null); }
  }

  return (
    <div className="grid gap-4">
      {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}

      {org.canManage && (
        <Card title="Add a brand" description="A brand is a product or customer you call on behalf of. Campaigns, SMS sender IDs and Customer.io workspaces are grouped by brand, and the switcher at the top of the sidebar filters the console to one brand.">
          <form onSubmit={add} className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex-1 min-w-0">
              <label htmlFor="brand-name" className="mb-1.5 block text-xs font-medium text-[var(--text-2)]">Brand name</label>
              <input id="brand-name" required minLength={2} maxLength={60} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Fortune Play" className={inputCls} />
            </div>
            <div>
              <span className="mb-1.5 block text-xs font-medium text-[var(--text-2)]">Colour</span>
              <div className="flex h-10 items-center gap-1.5">
                {SWATCHES.map((c) => (
                  <button key={c} type="button" aria-label={`Colour ${c}`} onClick={() => setColor(c)} className={`h-6 w-6 rounded-full ring-2 transition ${color === c ? "ring-white/80" : "ring-transparent hover:ring-white/30"}`} style={{ background: c }} />
                ))}
              </div>
            </div>
            <button type="submit" disabled={busy === "add" || name.trim().length < 2} className={primaryBtn}>
              {busy === "add" ? <Loader2 size={14} className="animate-spin" /> : <Plus size={15} />} Add brand
            </button>
          </form>
        </Card>
      )}

      <Card title="Brands" description={org.brands.length ? `${org.brands.length} ${org.brands.length === 1 ? "brand" : "brands"}` : "No brands yet"}>
        {org.brands.length === 0 ? (
          <div className="flex flex-col items-center py-8 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary"><Palette size={22} /></span>
            <p className="mt-3 text-sm font-medium text-[var(--text-1)]">No brands yet</p>
            <p className="mt-1 max-w-sm text-xs text-[var(--text-3)]">Without brands, everything in the console is one workspace. Add a brand for each product or customer you call for.</p>
          </div>
        ) : (
          <ul className="divide-y divide-[var(--border)]">
            {org.brands.map((b) => (
              <li key={b.id} className="py-3">
                {editing?.id === b.id ? (
                  <form onSubmit={saveEdit} className="flex flex-col gap-3 sm:flex-row sm:items-center">
                    <input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} minLength={2} maxLength={60} className={`${inputCls} sm:max-w-xs`} autoFocus />
                    <div className="flex items-center gap-1.5">
                      {SWATCHES.map((c) => (
                        <button key={c} type="button" aria-label={`Colour ${c}`} onClick={() => setEditing({ ...editing, color: c })} className={`h-6 w-6 rounded-full ring-2 transition ${editing.color === c ? "ring-white/80" : "ring-transparent hover:ring-white/30"}`} style={{ background: c }} />
                      ))}
                    </div>
                    <div className="flex gap-2 sm:ml-auto">
                      <button type="submit" disabled={busy === b.id} className={`${primaryBtn} h-9 px-3 text-xs`}>Save</button>
                      <button type="button" onClick={() => setEditing(null)} className={ghostBtn}><X size={13} /></button>
                    </div>
                  </form>
                ) : (
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-xs font-bold text-white" style={{ background: b.color ?? "#4a5160" }}>{brandGlyph(b.name)}</span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-[var(--text-1)]">{b.name}</p>
                      <p className="font-mono text-[11px] text-[var(--text-3)]">{b.slug}</p>
                    </div>
                    {org.canManage && (
                      <div className="flex items-center gap-2">
                        <button type="button" onClick={() => setEditing(b)} className={ghostBtn}><Pencil size={13} /> Edit</button>
                        <button type="button" onClick={() => remove(b)} disabled={busy === b.id} className={dangerBtn} title="Delete brand"><Trash2 size={13} /></button>
                      </div>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
