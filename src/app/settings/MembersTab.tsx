"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { Copy, Loader2, Mail, Trash2, UserPlus } from "lucide-react";
import { useOrg } from "@/lib/orgContext";
import { Card, Notice, RoleBadge, api, dangerBtn, ghostBtn, inputCls, primaryBtn, selectCls } from "./ui";

interface Member { userId: string; role: string; email: string | null; joinedAt: string; lastSignInAt: string | null; isYou: boolean }
interface Invite { id: string; email: string; role: string; token: string; created_at: string; expires_at: string; accepted_at: string | null }

const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—");

export default function MembersTab() {
  const org = useOrg();
  const [members, setMembers] = useState<Member[] | null>(null);
  const [invites, setInvites] = useState<Invite[] | null>(null);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"member" | "admin">("member");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ kind: "ok" | "error" | "info"; text: string } | null>(null);
  const [lastLink, setLastLink] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const m = await api<{ members: Member[] }>("/api/org/members");
      setMembers(m.members);
      if (org.canManage) {
        const i = await api<{ invites: Invite[] }>("/api/org/invites");
        setInvites(i.invites);
      }
    } catch (e) {
      setMsg({ kind: "error", text: e instanceof Error ? e.message : "Could not load members" });
    }
  }, [org.canManage]);
  useEffect(() => { if (org.loaded && org.org) load(); }, [org.loaded, org.org, load]);

  async function invite(e: FormEvent) {
    e.preventDefault();
    setBusy("invite"); setMsg(null); setLastLink(null);
    try {
      const r = await api<{ invite: { link: string; emailed: boolean; email: string } }>("/api/org/invites", { method: "POST", body: JSON.stringify({ email, role }) });
      setLastLink(r.invite.link);
      setMsg({ kind: "ok", text: r.invite.emailed ? `Invitation emailed to ${r.invite.email}. You can also share the link below.` : `Invite created for ${r.invite.email}. Email sending isn't configured, so share the link below with them.` });
      setEmail("");
      await load();
    } catch (err) {
      setMsg({ kind: "error", text: err instanceof Error ? err.message : "Could not create the invite" });
    } finally {
      setBusy(null);
    }
  }

  async function setMemberRole(userId: string, newRole: string) {
    setBusy(userId); setMsg(null);
    try { await api("/api/org/members", { method: "PATCH", body: JSON.stringify({ userId, role: newRole }) }); await load(); }
    catch (err) { setMsg({ kind: "error", text: err instanceof Error ? err.message : "Could not change the role" }); }
    finally { setBusy(null); }
  }

  async function remove(m: Member) {
    if (!confirm(`Remove ${m.email ?? "this member"} from the organization?`)) return;
    setBusy(m.userId); setMsg(null);
    try { await api(`/api/org/members?userId=${m.userId}`, { method: "DELETE" }); await load(); }
    catch (err) { setMsg({ kind: "error", text: err instanceof Error ? err.message : "Could not remove the member" }); }
    finally { setBusy(null); }
  }

  async function revoke(inv: Invite) {
    setBusy(inv.id); setMsg(null);
    try { await api(`/api/org/invites/${inv.id}`, { method: "DELETE" }); await load(); }
    catch (err) { setMsg({ kind: "error", text: err instanceof Error ? err.message : "Could not revoke the invite" }); }
    finally { setBusy(null); }
  }

  const copy = (text: string) => navigator.clipboard?.writeText(text).then(() => setMsg({ kind: "ok", text: "Link copied." })).catch(() => setMsg({ kind: "error", text: "Couldn't copy — select and copy the link by hand." }));

  if (!org.loaded) return <div className="h-40 animate-pulse rounded-2xl bg-[var(--bg-elevated)]" />;
  if (!org.org) return <Notice kind="info">You&apos;re not in an organization yet.</Notice>;

  return (
    <div className="grid gap-4">
      {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}

      {org.canManage && (
        <Card title="Invite someone" description="They get a link to create their account (or sign in) and join this organization. Admins can manage members, brands and integrations; members can run campaigns and build agents.">
          <form onSubmit={invite} className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex-1 min-w-0">
              <label htmlFor="inv-email" className="mb-1.5 block text-xs font-medium text-[var(--text-2)]">Email</label>
              <input id="inv-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="colleague@company.com" className={inputCls} />
            </div>
            <div>
              <label htmlFor="inv-role" className="mb-1.5 block text-xs font-medium text-[var(--text-2)]">Role</label>
              <select id="inv-role" value={role} onChange={(e) => setRole(e.target.value as "member" | "admin")} className={`${selectCls} w-full sm:w-36`}>
                <option value="member">Member</option>
                <option value="admin">Admin</option>
              </select>
            </div>
            <button type="submit" disabled={busy === "invite" || !email} className={primaryBtn}>
              {busy === "invite" ? <Loader2 size={14} className="animate-spin" /> : <UserPlus size={15} />} Send invite
            </button>
          </form>
          {lastLink && (
            <div className="mt-4 flex flex-col gap-2 rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] p-3 sm:flex-row sm:items-center">
              <code className="min-w-0 flex-1 break-all font-mono text-xs text-[var(--text-2)]">{lastLink}</code>
              <button type="button" onClick={() => copy(lastLink)} className={ghostBtn}><Copy size={13} /> Copy link</button>
            </div>
          )}
        </Card>
      )}

      <Card title="Members" description={members ? `${members.length} ${members.length === 1 ? "person" : "people"} in ${org.org.name}` : undefined}>
        {!members ? <div className="h-24 animate-pulse rounded-xl bg-[var(--bg-elevated)]" /> : (
          <ul className="divide-y divide-[var(--border)]">
            {members.map((m) => (
              <li key={m.userId} className="flex flex-wrap items-center gap-3 py-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-blue-700 text-xs font-bold text-white">{(m.email?.[0] ?? "?").toUpperCase()}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-[var(--text-1)]">{m.email ?? m.userId}{m.isYou && <span className="ml-1.5 text-xs text-[var(--text-3)]">(you)</span>}</p>
                  <p className="text-[11px] text-[var(--text-3)]">Joined {fmt(m.joinedAt)} · Last sign-in {fmt(m.lastSignInAt)}</p>
                </div>
                {org.canManage && !m.isYou && m.role !== "owner" ? (
                  <div className="flex items-center gap-2">
                    <select value={m.role} disabled={busy === m.userId} onChange={(e) => setMemberRole(m.userId, e.target.value)} className={`${selectCls} h-9 text-xs`}>
                      <option value="member">Member</option>
                      <option value="admin">Admin</option>
                    </select>
                    <button type="button" onClick={() => remove(m)} disabled={busy === m.userId} className={dangerBtn} title="Remove from organization"><Trash2 size={13} /></button>
                  </div>
                ) : <RoleBadge role={m.role} />}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {org.canManage && invites && invites.filter((i) => !i.accepted_at).length > 0 && (
        <Card title="Pending invites">
          <ul className="divide-y divide-[var(--border)]">
            {invites.filter((i) => !i.accepted_at).map((inv) => {
              const expired = new Date(inv.expires_at) < new Date();
              const link = `${window.location.origin}/invite/${inv.token}`;
              return (
                <li key={inv.id} className="flex flex-wrap items-center gap-3 py-3">
                  <Mail size={16} className="shrink-0 text-[var(--text-3)]" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-[var(--text-1)]">{inv.email} <RoleBadge role={inv.role} /></p>
                    <p className="text-[11px] text-[var(--text-3)]">{expired ? "Expired" : `Expires ${fmt(inv.expires_at)}`}</p>
                  </div>
                  <button type="button" onClick={() => copy(link)} className={ghostBtn}><Copy size={13} /> Copy link</button>
                  <button type="button" onClick={() => revoke(inv)} disabled={busy === inv.id} className={dangerBtn}>Revoke</button>
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </div>
  );
}
