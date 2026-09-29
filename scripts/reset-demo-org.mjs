#!/usr/bin/env node
// Deletes an organization and everything it owns, so a demo account can go through onboarding
// again. Platform use only (service role). Order matters because some links between rows are
// not cascading (script boxes → Playbook lines).
//
//   node scripts/reset-demo-org.mjs <org-slug>            e.g. node scripts/reset-demo-org.mjs harbour-grill-group
//   node scripts/reset-demo-org.mjs --user demo@optinetsolutions.com   (whatever org that user is in)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
for (const line of fs.existsSync(path.join(root, ".env.local")) ? fs.readFileSync(path.join(root, ".env.local"), "utf8").split(/\r?\n/) : []) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/\s+#.*$/, "").trim();
}
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL, KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_ || !KEY) { console.error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing"); process.exit(1); }
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" };
const rest = async (p, init = {}) => { const r = await fetch(`${URL_}/rest/v1/${p}`, { ...init, headers: { ...H, Prefer: "return=minimal", ...(init.headers ?? {}) } }); if (!r.ok && r.status !== 404) throw new Error(`${init.method ?? "GET"} ${p.split("?")[0]} → ${r.status} ${(await r.text()).slice(0, 200)}`); return r; };
const get = async (p) => (await (await fetch(`${URL_}/rest/v1/${p}`, { headers: H })).json());

const args = process.argv.slice(2);
let slug = args.find((a) => !a.startsWith("--"));
const userArg = args.includes("--user") ? args[args.indexOf("--user") + 1] : null;
if (userArg) {
  const users = await (await fetch(`${URL_}/auth/v1/admin/users?per_page=200`, { headers: H })).json();
  const u = (users.users ?? []).find((x) => x.email?.toLowerCase() === userArg.toLowerCase());
  if (!u) { console.error("no such user"); process.exit(1); }
  const m = (await get(`organization_members?select=org_id,organizations(slug)&user_id=eq.${u.id}`))[0];
  if (!m) { console.log(`${userArg} is not in an organization — nothing to reset.`); process.exit(0); }
  slug = m.organizations?.slug;
}
if (!slug) { console.error("usage: node scripts/reset-demo-org.mjs <org-slug> | --user <email>"); process.exit(1); }
const org = (await get(`organizations?select=id,name&slug=eq.${encodeURIComponent(slug)}`))[0];
if (!org) { console.error(`organization "${slug}" not found`); process.exit(1); }
if (slug === "optinet") { console.error("refusing to delete the Optinet organization"); process.exit(1); }
const O = `org_id=eq.${org.id}`;

// Scripts (edges → nodes → scripts), then collections, handlers and the rest; the org last.
const scripts = await get(`listener_scripts?select=id&${O}`);
for (const s of scripts) {
  await rest(`listener_script_edges?script_id=eq.${s.id}`, { method: "DELETE" });
  await rest(`listener_script_nodes?script_id=eq.${s.id}`, { method: "DELETE" });
  await rest(`lab_call_flow_state?script_id=eq.${s.id}`, { method: "DELETE" });
}
await rest(`listener_scripts?${O}`, { method: "DELETE" });
const cols = await get(`listener_collections?select=id&${O}`);
for (const c of cols) await rest(`listener_collection_handlers?collection_id=eq.${c.id}`, { method: "DELETE" });
await rest(`listener_collections?${O}`, { method: "DELETE" });
await rest(`listener_handlers?${O}`, { method: "DELETE" });
for (const t of ["campaigns_v2", "knowledge_bases", "do_not_call", "suppression_list", "local_segments", "ghost_runs", "listener_qa_prompts", "golden_eval_sets", "phone_numbers", "org_integrations", "agent_purchases", "organization_invites", "brands", "organization_members"]) {
  await rest(`${t}?${O}`, { method: "DELETE" });
}
await rest(`organizations?id=eq.${org.id}`, { method: "DELETE" });
console.log(`reset: organization "${org.name}" (${slug}) and ${scripts.length} scripts removed. Its members can go through onboarding again.`);
