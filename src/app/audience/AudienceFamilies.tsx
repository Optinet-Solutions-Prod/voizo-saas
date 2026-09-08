"use client";

// Campaign families (Audience mockup 2026-08-25, `families()` + `expand()` + `calendar()` +
// `numbers()`, read whole), slice 3 of the wire. Full expand as the mockup (Jasiel 2026-09-07):
//   - a row per family: name · ⚑ market (All markets only) · members · runs · status
//   - the expand: the Active-days row (Sunday-first, the campaign wizard's vocabulary) picks the run
//     inside the selected week; the week picker is a PERIOD picker (year, month, week), never a
//     42-cell day grid; the run's card is the dashboard's own CampaignRow, records on click; then
//     the run's numbers, ten to a page, filtered by name or number.
// Pages of 10 families (Jasiel 2026-09-03: pages, never "show all").
//
// A family is Campaign Performance's family (the recurring parent), so this list and that table
// agree on what a family is. Members are DISTINCT PHONES across the family's campaigns, from the
// same RPC the Reach card uses; null until that function exists in the database.
import { useEffect, useState } from "react";
import { ChevronRight, CalendarDays, Search, X } from "lucide-react";
import { loadSnapshot, saveSnapshot } from "@/lib/sessionSnapshot";
import Pagination from "@/components/Pagination";
import StyledSelect from "@/components/StyledSelect";
import SortHead, { SortButton, nextSort, type SortDir } from "./SortHead";
import { Pulse } from "./AudienceReach";
import CampaignRow, { StatusPill, type CampaignRowData, type DisplayStatus } from "../analytics/CampaignRow";
import CampaignExpand from "@/components/analytics/CampaignExpand";
import PromptModal from "../analytics/PromptModal";
import { ROW_COLOR } from "../analytics/PerformanceCards";
import { formatCampaign } from "@/lib/campaignDisplay";
import type { TodayPerfDay } from "@/lib/dashboardAnalytics";
import type { Dot } from "@/lib/audienceLane";
import type { AudienceFamily, FamilyRun } from "../api/audience/reach/route";
import type { RunNumbersResponse } from "../api/audience/run-numbers/route";

const PAGE = 10;
const fmt = (n: number | null | undefined) => (n == null ? "—" : n.toLocaleString("en-US"));

// ── UTC date helpers, the mockup's, Sunday-first like wizardState.DAYS ──
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAYS_HOUSE: [string, string][] = [["SUN", "Sunday"], ["MON", "Monday"], ["TUE", "Tuesday"], ["WED", "Wednesday"], ["THU", "Thursday"], ["FRI", "Friday"], ["SAT", "Saturday"]];
const D = (iso: string) => new Date(iso + "T00:00:00Z");
const toIso = (d: Date) => d.toISOString().slice(0, 10);
const dowOf = (iso: string) => D(iso).getUTCDay();
const addDays = (iso: string, n: number) => { const t = D(iso); t.setUTCDate(t.getUTCDate() + n); return toIso(t); };
const wkStart = (iso: string) => addDays(iso, -dowOf(iso));
const shortDate = (iso: string) => `${MONTHS[D(iso).getUTCMonth()]} ${D(iso).getUTCDate()}`;
const fmtLabel = (iso: string) => { const t = D(iso); return `${DOW[t.getUTCDay()]} ${MONTHS[t.getUTCMonth()]} ${t.getUTCDate()}, ${t.getUTCFullYear()}`; };
const p2 = (n: number) => String(n).padStart(2, "0");
const mmddhm = (iso: string | null) => {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : `${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())} ${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}`;
};
const dayOf = (r: FamilyRun) => (r.startAt ?? "").slice(0, 10);

const DOT_LABEL: Record<Dot, string> = { spoke: "spoke", silent: "answered, no conversation", voicemail: "voicemail", never: "never connected" };
// The run's own filters (Jasiel 2026-09-07: "players who deposited during that child-spawned campaign").
const RUN_DEPOSITED = [
  { value: "any", label: "Any" },
  { value: "after", label: "After this run" },
  { value: "none", label: "None on record" },
  { value: "unknown", label: "No CRM record" },
];
const RUN_CONTACT = [
  { value: "any", label: "Any" },
  { value: "reached", label: "Reached" },
  { value: "texted", label: "Texted" },
  { value: "delivered", label: "SMS delivered" },
  { value: "never", label: "Never reached" },
];
const DOT_COLOR: Record<Dot, string> = { spoke: ROW_COLOR.reached, silent: ROW_COLOR.silent_pickup, voicemail: ROW_COLOR.voicemail, never: ROW_COLOR.unreachable };

// The dashboard's campaigns payload, the fields the run card needs (CampaignTable's Row, trimmed).
interface CampRow {
  id: string; name: string; country: string; cioWorkspace: string | null; voiceId: string | null; agentLabel: string | null;
  baseAssistantId: string | null; scheduleType: "fixed" | "recurring"; displayStatus: DisplayStatus; players: number;
  startAt: string | null; endAt: string | null; lastCallAt: string | null; perf: TodayPerfDay;
}
const fmtShort = (iso: string | null) => { if (!iso) return null; const d = new Date(iso); return Number.isNaN(d.getTime()) ? null : `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`; };
function rowDataOf(r: CampRow): CampaignRowData {
  const start = fmtShort(r.startAt);
  const timeLabel = !start ? "—" : r.displayStatus === "running" || r.displayStatus === "paused" ? `${start} → ongoing` : `${start} → ${fmtShort(r.endAt ?? r.lastCallAt) ?? "—"}`;
  return { id: r.id, name: r.name, country: r.country, cioWorkspace: r.cioWorkspace, voiceId: r.voiceId, agentLabel: r.agentLabel, baseAssistantId: r.baseAssistantId, scheduleType: r.scheduleType, status: r.displayStatus, timeLabel, players: r.players, startAt: r.startAt, perf: r.perf };
}

export default function AudienceFamilies({ families, loading, showMarket, unavailable }: {
  families: AudienceFamily[];
  loading: boolean;
  showMarket: boolean;
  unavailable?: string;
}) {
  const [page, setPage] = useState(1);
  const [openKey, setOpenKey] = useState<string | null>(null);
  // Column sorting on the family list runs in the browser: 42 rows, all in hand. Default = the route's
  // order (running first, most runs, name), which "status" reproduces.
  type FamilySort = "family" | "members" | "runs" | "status";
  const [fSort, setFSort] = useState<{ sort: FamilySort; dir: SortDir }>({ sort: "status", dir: "desc" });
  const STATUS_RANK = { running: 2, paused: 1, finished: 0 } as const;
  const sorted = [...families].sort((a, b) => {
    const d = fSort.dir === "asc" ? 1 : -1;
    const cmp = (x: number | string | null, y: number | string | null) => (x == null && y == null ? 0 : x == null ? 1 : y == null ? -1 : x < y ? -d : x > y ? d : 0);
    switch (fSort.sort) {
      case "family": return cmp(a.label.toLowerCase(), b.label.toLowerCase()) || cmp(a.market, b.market);
      case "members": return cmp(a.members, b.members) || cmp(a.runs, b.runs);
      case "runs": return cmp(a.runs, b.runs) || cmp(a.members, b.members);
      default: return cmp(STATUS_RANK[a.status], STATUS_RANK[b.status]) || cmp(a.runs, b.runs) || a.label.localeCompare(b.label);
    }
  });
  const sortBy = (k: FamilySort) => { setFSort(nextSort(fSort, k, ["family"])); setPage(1); };
  // The dashboard's campaigns rows, for the run card. Fetched on the first expand, painted from
  // the last session's snapshot first (the same key CampaignTable saves under).
  const [camps, setCamps] = useState<Map<string, CampRow> | null>(null);
  const [campsErr, setCampsErr] = useState<string | null>(null);
  const [prevFamilies, setPrevFamilies] = useState(families);
  if (prevFamilies !== families) { setPrevFamilies(families); setPage(1); setOpenKey(null); }

  const pages = Math.max(1, Math.ceil(families.length / PAGE));
  const cur = Math.min(page, pages);
  const shown = sorted.slice((cur - 1) * PAGE, cur * PAGE);

  const ensureCamps = () => {
    if (camps) return;
    const snap = loadSnapshot<{ rows: CampRow[] }>("dashboard.campaigns");
    if (snap?.rows) setCamps(new Map(snap.rows.map((r) => [r.id, r])));
    fetch("/api/dashboard/campaigns", { cache: "no-store" })
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then((j: { rows: CampRow[] }) => { setCamps(new Map(j.rows.map((r) => [r.id, r]))); saveSnapshot("dashboard.campaigns", j); setCampsErr(null); })
      .catch((e: unknown) => setCampsErr(e instanceof Error ? e.message : "Failed to load the run"));
  };
  const toggle = (key: string) => { setOpenKey((k) => (k === key ? null : key)); ensureCamps(); };

  return (
    <section className="bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl overflow-hidden" aria-label="Campaign families">
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-[var(--border)]">
        <h2 className="text-[12.5px] font-medium text-[var(--text-2)]">Campaign families</h2>
        <span className="ml-auto font-mono text-[11px] text-[var(--text-4)]" aria-label="Families">{loading && families.length === 0 ? "" : families.length}</span>
      </div>
      {loading && families.length === 0 ? (
        // Placeholders the shape of the rows they stand in for, so the panel keeps its height and
        // the operator sees where the name and the three figures will land (the AudienceReach pattern).
        <div aria-label="Loading campaign families" aria-busy="true">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="flex items-center gap-[11px] px-4 py-[9px] border-b border-[var(--border)] pl-[37px]">
              <Pulse w={i % 2 ? "w-40" : "w-52"} />
              <div className="ml-auto flex items-center gap-[9px]">
                <Pulse w="w-10" /><Pulse w="w-8" /><Pulse w="w-14" />
              </div>
            </div>
          ))}
        </div>
      ) : families.length === 0 ? (
        <p className="px-4 py-8 text-center text-xs text-[var(--text-3)]">No campaign family in this scope.</p>
      ) : (
        <>
        {/* The rows are buttons, not table cells, so the sort header mirrors their layout: the name at
            the left, the three figures grouped at the right with the rows' own gaps. */}
        <div className="flex items-center gap-[11px] px-4 py-1.5 border-b border-[var(--border)] pl-[37px]" role="group" aria-label="Sort families">
          <SortButton label="Family" k="family" sort={fSort.sort} dir={fSort.dir} onSort={sortBy} />
          <div className="ml-auto flex items-center gap-[9px]">
            <SortButton label="Members" k="members" sort={fSort.sort} dir={fSort.dir} onSort={sortBy} />
            <SortButton label="Runs" k="runs" sort={fSort.sort} dir={fSort.dir} onSort={sortBy} />
            <SortButton label="Status" k="status" sort={fSort.sort} dir={fSort.dir} onSort={sortBy} />
          </div>
        </div>
        {shown.map((f, i) => {
          const on = f.key === openKey;
          return (
            <div key={f.key} className={i === 0 ? "" : "border-t border-[var(--border)]"}>
              <button
                type="button"
                aria-expanded={on}
                onClick={() => toggle(f.key)}
                className="w-full flex items-center gap-[11px] px-4 py-[11px] text-left hover:bg-[var(--bg-hover)] transition-colors"
              >
                <ChevronRight size={11} className={`shrink-0 text-[var(--text-4)] transition-transform ${on ? "rotate-90" : ""}`} strokeWidth={2.2} />
                <span className="text-[12.5px] text-[var(--text-1)] truncate">{f.label}</span>
                <span className="ml-auto flex items-center gap-[9px] shrink-0 font-mono text-[11px] text-[var(--text-4)]">
                  {showMarket && f.market && <span>⚑ {f.market}</span>}
                  <span title={unavailable && f.members == null ? unavailable : undefined}>{f.members == null ? "—" : fmt(f.members)} members</span>
                  <span>{f.runs} {f.runs === 1 ? "run" : "runs"}</span>
                  <StatusPill s={f.status} />
                </span>
              </button>
              {on && <FamilyExpand family={f} camps={camps} campsErr={campsErr} />}
            </div>
          );
        })}
        </>
      )}
      {families.length > PAGE && (
        <div className="flex justify-end px-4 py-2 border-t border-[var(--border)]">
          <Pagination currentPage={cur} totalPages={pages} totalItems={families.length} pageSize={PAGE} onPageChange={setPage} noun="families" />
        </div>
      )}
    </section>
  );
}

function FamilyExpand({ family, camps, campsErr }: { family: AudienceFamily; camps: Map<string, CampRow> | null; campsErr: string | null }) {
  const runs = family.runList.filter((r) => r.startAt); // newest first, from the route
  const [runId, setRunId] = useState<string | null>(runs[0]?.id ?? null);
  const [recordsOpen, setRecordsOpen] = useState(false);
  const [promptOpen, setPromptOpen] = useState(false);
  const run = runs.find((r) => r.id === runId) ?? null;
  const runDay = run ? dayOf(run) : null;
  const week = runDay ? wkStart(runDay) : null;
  // The run on each weekday OF THE SELECTED WEEK; a day that spawned twice keeps its newest run.
  const byDow = new Map<number, FamilyRun>();
  if (week) for (const r of [...runs].reverse()) if (wkStart(dayOf(r)) === week) byDow.set(dowOf(dayOf(r)), r);
  const camp = runId ? camps?.get(runId) ?? null : null;

  if (!run) {
    return <div className="border-t border-[var(--border)] bg-[var(--bg-app)] px-4 py-3.5 text-[11.5px] text-[var(--text-4)]">No run has started in this family yet.</div>;
  }
  return (
    <div className="border-t border-[var(--border)] bg-[var(--bg-app)] px-4 py-3.5">
      <span className="block text-[11.5px] font-medium text-[var(--text-2)] mb-[7px]">Active days</span>
      <div className="flex gap-1.5 w-full" role="radiogroup" aria-label="Run of the week">
        {DAYS_HOUSE.map(([short, long], i) => {
          const hit = byDow.get(i);
          const pressed = hit?.id === runId;
          return (
            <button
              key={short}
              type="button"
              role="radio"
              aria-checked={pressed}
              disabled={!hit}
              onClick={() => hit && setRunId(hit.id)}
              title={hit ? `${long}, run of ${dayOf(hit)}` : `no ${long} run in this week`}
              className={`flex-1 py-[9px] rounded-xl border-[1.5px] font-mono text-[11px] font-semibold tracking-[.09em] transition-colors ${
                pressed ? "border-primary text-primary bg-primary/10" : "border-[var(--border)] bg-[var(--bg-app)] text-[var(--text-3)] hover:border-[var(--border-2)] hover:text-[var(--text-2)]"
              } disabled:opacity-[.28] disabled:cursor-not-allowed`}
            >
              {short}
            </button>
          );
        })}
      </div>
      <div className="flex items-center gap-[5px] flex-wrap mt-[9px] mb-[13px]">
        <WeekPicker runs={runs} openRun={run} onPick={(id) => setRunId(id)} />
        <span className="ml-auto font-mono text-[10.5px] text-[var(--text-4)]">{fmtLabel(runDay!)} · {runs.length} {runs.length === 1 ? "run" : "runs"} held</span>
      </div>

      {/* The recycled dashboard card, full fidelity on purpose: you clicked for it. */}
      <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] overflow-hidden">
        {camp ? (
          <>
            <CampaignRow c={rowDataOf(camp)} expanded={recordsOpen} onToggle={() => setRecordsOpen((v) => !v)} onViewPrompt={() => setPromptOpen(true)} />
            {recordsOpen && (
              <div className="px-3.5 pb-3.5">
                <CampaignExpand campaignId={camp.id} name={camp.name} />
              </div>
            )}
          </>
        ) : (
          <p className="px-3.5 py-3 text-[11.5px] text-[var(--text-4)]">{campsErr ? `The run's card did not load: ${campsErr}` : camps ? "This run is not in the dashboard's campaign list." : "Loading the run…"}</p>
        )}
      </div>
      {promptOpen && camp && <PromptModal campaignId={camp.id} title={formatCampaign(camp.name).display} onClose={() => setPromptOpen(false)} />}

      <RunNumbers key={run.id} campaignId={run.id} />
    </div>
  );
}

// ── the week picker: year · month · week. The Active-days row already answers "which weekday",
//    so a day grid would restate it. Weeks run Sunday-first. Selecting a week lands on its newest run. ──
function WeekPicker({ runs, openRun, onPick }: { runs: FamilyRun[]; openRun: FamilyRun; onPick: (runId: string) => void }) {
  const openDay = dayOf(openRun);
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<string | null>(null); // "YYYY-MM" on screen
  const [pending, setPending] = useState<string | null>(null); // staged week (its Sunday)
  const [pick, setPick] = useState(false); // month/year chooser
  const shownWeek = pending ?? wkStart(openDay);
  const v = view ?? shownWeek.slice(0, 7);
  const [vy, vm] = v.split("-").map(Number);
  const perWeek = new Map<string, number>();
  for (const r of runs) { const w = wkStart(dayOf(r)); perWeek.set(w, (perWeek.get(w) ?? 0) + 1); }
  const weeks: string[] = [];
  const lastDay = `${v}-${p2(new Date(Date.UTC(vy, vm, 0)).getUTCDate())}`;
  for (let w = wkStart(`${v}-01`); w <= lastDay; w = addDays(w, 7)) weeks.push(w);
  const inWeek = runs.filter((r) => wkStart(dayOf(r)) === shownWeek).length;
  const perMonth = new Map<string, number>();
  for (const [ws, n] of perWeek) {
    perMonth.set(ws.slice(0, 7), (perMonth.get(ws.slice(0, 7)) ?? 0) + n);
    const we = addDays(ws, 6).slice(0, 7);
    if (we !== ws.slice(0, 7)) perMonth.set(we, (perMonth.get(we) ?? 0) + n);
  }
  const close = () => { setOpen(false); setView(null); setPending(null); setPick(false); };
  const moveMonths = (n: number) => { const t = new Date(Date.UTC(vy, vm - 1 + n, 1)); setView(`${t.getUTCFullYear()}-${p2(t.getUTCMonth() + 1)}`); };
  const select = () => {
    // a week is not a run: commit it by landing on the newest run inside it
    const hit = runs.find((r) => wkStart(dayOf(r)) === shownWeek);
    if (hit) onPick(hit.id);
    close();
  };
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  const btn = "rounded-md font-mono text-[11px] text-[var(--text-3)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-1)]";
  return (
    <div className="relative">
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => (open ? close() : setOpen(true))}
        className="flex items-center gap-[7px] px-2.5 py-[5px] rounded-[7px] border border-[var(--border)] bg-[var(--bg-elevated)] font-mono text-[11px] text-[var(--text-2)] hover:border-[var(--border-2)] hover:text-[var(--text-1)]"
      >
        <CalendarDays size={12} className="text-[var(--text-4)]" strokeWidth={1.8} />
        {shortDate(wkStart(openDay))} – {shortDate(addDays(wkStart(openDay), 6))}
      </button>
      {open && (
        <div role="dialog" aria-label="Pick a week" className="absolute top-[calc(100%+5px)] left-0 z-[35] w-[262px] p-[11px] rounded-xl border border-[var(--border-2)] bg-[var(--bg-elevated)] shadow-[0_16px_40px_-10px_rgba(0,0,0,.7)] select-none">
          <div className="flex items-center justify-between mb-[9px]">
            <div className="flex gap-px">
              <button type="button" title="Previous year" onClick={() => moveMonths(-12)} className={`w-[22px] h-[22px] grid place-items-center ${btn}`}>«</button>
              <button type="button" title="Previous month" onClick={() => moveMonths(-1)} className={`w-[22px] h-[22px] grid place-items-center ${btn}`}>‹</button>
            </div>
            <button type="button" aria-expanded={pick} title="Jump to a month or year" onClick={() => setPick((p) => !p)} className={`flex items-center gap-[5px] px-2 py-[3px] rounded-[7px] font-mono text-[12.5px] font-medium text-[var(--text-1)] hover:bg-[var(--bg-hover)] ${pick ? "bg-[var(--bg-hover)]" : ""}`}>
              {MONTHS[vm - 1]} {vy} <span className="text-[8px] text-[var(--text-4)]">▾</span>
            </button>
            <div className="flex gap-px">
              <button type="button" title="Next month" onClick={() => moveMonths(1)} className={`w-[22px] h-[22px] grid place-items-center ${btn}`}>›</button>
              <button type="button" title="Next year" onClick={() => moveMonths(12)} className={`w-[22px] h-[22px] grid place-items-center ${btn}`}>»</button>
            </div>
          </div>
          {pick ? (
            <>
              <div className="text-[9.5px] font-semibold uppercase tracking-[.07em] text-[var(--text-4)] my-[5px] mt-[9px]">Year</div>
              <div className="grid grid-cols-4 gap-[3px]">
                {[vy - 2, vy - 1, vy, vy + 1].map((y) => (
                  <button key={y} type="button" onClick={() => setView(`${y}-${p2(vm)}`)} className={`py-1.5 rounded-[7px] font-mono text-[11px] border ${y === vy ? "border-primary text-[var(--text-1)]" : "border-transparent text-[var(--text-3)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-1)]"}`}>{y}</button>
                ))}
              </div>
              <div className="text-[9.5px] font-semibold uppercase tracking-[.07em] text-[var(--text-4)] my-[5px] mt-[9px]">Month</div>
              <div className="grid grid-cols-4 gap-[3px]">
                {MONTHS.map((mo, i) => {
                  const key = `${vy}-${p2(i + 1)}`, n = perMonth.get(key) ?? 0;
                  return (
                    <button key={mo} type="button" title={n ? `${n} run${n === 1 ? "" : "s"} in ${mo} ${vy}` : `no runs in ${mo} ${vy}`} onClick={() => { setView(key); setPick(false); }}
                      className={`relative py-[7px] rounded-[7px] font-mono text-[11px] border border-transparent ${i + 1 === vm ? "bg-primary text-white font-semibold" : "text-[var(--text-3)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-1)]"}`}>
                      {mo}{n ? <i className={`absolute top-px right-[3px] not-italic text-[8px] ${i + 1 === vm ? "text-white" : "text-primary"}`}>{n}</i> : null}
                    </button>
                  );
                })}
              </div>
            </>
          ) : (
            <>
              <div className="text-[9.5px] font-semibold uppercase tracking-[.07em] text-[var(--text-4)] my-[5px] mt-[9px]">Week</div>
              <div className="flex flex-col gap-[3px]">
                {weeks.map((ws) => {
                  const n = perWeek.get(ws) ?? 0, sel = ws === shownWeek;
                  return (
                    <button key={ws} type="button" disabled={!n} onClick={() => { setPending(ws); setView(ws.slice(0, 7)); }} title={n ? `${n} run${n === 1 ? "" : "s"} this week` : "no runs this week"}
                      className={`flex items-center gap-2 px-[9px] py-1.5 rounded-[7px] font-mono text-[11px] text-left border ${sel ? "border-primary text-[var(--text-1)] bg-primary/10" : "border-transparent text-[var(--text-2)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-1)]"} disabled:opacity-30 disabled:cursor-not-allowed`}>
                      {shortDate(ws)} – {shortDate(addDays(ws, 6))}
                      <span className={`ml-auto text-[10px] ${sel ? "text-primary" : "text-[var(--text-4)]"}`}>{n ? `${n} run${n === 1 ? "" : "s"}` : "—"}</span>
                    </button>
                  );
                })}
              </div>
            </>
          )}
          <div className="text-center font-mono text-[11px] text-[var(--text-3)] mt-[9px]">{inWeek} {inWeek === 1 ? "run" : "runs"} in {shortDate(shownWeek)} – {shortDate(addDays(shownWeek, 6))}</div>
          <div className="flex items-center justify-between gap-2 pt-[9px] mt-[9px] border-t border-[var(--border)] text-[11px] font-medium text-[var(--text-3)]">
            <div className="flex gap-[11px]">
              <button type="button" title="Back to the latest week" onClick={() => { const w = wkStart(dayOf(runs[0])); setPending(w); setView(w.slice(0, 7)); }} className="hover:text-[#e46664]">Clear</button>
              <button type="button" onClick={() => { const t = toIso(new Date()); setView(t.slice(0, 7)); setPending(wkStart(t)); }} className="hover:text-primary">Today</button>
            </div>
            <div className="flex gap-1.5">
              <button type="button" onClick={close} className="px-2.5 py-1 rounded-md border border-[var(--border-2)] hover:text-[var(--text-1)]">Cancel</button>
              <button type="button" onClick={select} className="px-3 py-1 rounded-md bg-primary text-white font-semibold">Select</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── the numbers table inside a run: ten to a page, paged by the server ──
function RunNumbers({ campaignId }: { campaignId: string }) {
  const [q, setQ] = useState("");
  const [needle, setNeedle] = useState("");
  const [deposited, setDeposited] = useState("any");
  const [contact, setContact] = useState("any");
  type RunSort = "last_contact" | "amount" | "phone" | "calls";
  const [rSort, setRSort] = useState<{ sort: RunSort; dir: SortDir }>({ sort: "last_contact", dir: "desc" });
  const sortBy = (k: RunSort) => { setRSort(nextSort(rSort, k, ["phone"])); setPage(1); };
  const [page, setPage] = useState(1);
  const [data, setData] = useState<RunNumbersResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { const t = setTimeout(() => { setNeedle(q.trim()); setPage(1); }, 300); return () => clearTimeout(t); }, [q]);
  useEffect(() => {
    const ctrl = new AbortController();
    const sp = new URLSearchParams({ campaign: campaignId, page: String(page) });
    if (needle) sp.set("q", needle);
    if (deposited !== "any") sp.set("deposited", deposited);
    if (contact !== "any") sp.set("contact", contact);
    if (rSort.sort !== "last_contact") sp.set("sort", rSort.sort);
    if (rSort.dir !== "desc") sp.set("dir", rSort.dir);
    fetch(`/api/audience/run-numbers?${sp}`, { cache: "no-store", signal: ctrl.signal })
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then((j: RunNumbersResponse) => { setData(j); setError(null); })
      .catch((e: unknown) => { if (!(e instanceof Error && e.name === "AbortError")) setError(e instanceof Error ? e.message : "Failed to load numbers"); });
    return () => ctrl.abort();
  }, [campaignId, page, needle, deposited, contact, rSort]);
  const rows = data?.rows ?? [];
  const filtered = deposited !== "any" || contact !== "any";
  const total = data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / (data?.pageSize ?? 10)));
  return (
    <div className="mt-[15px] pt-[13px] border-t border-[var(--border)]">
      <div className="flex items-center gap-[9px] mb-[9px]">
        <span className="text-[10px] uppercase tracking-[.06em] text-[var(--text-4)]">Numbers on this run</span>
        <label className="relative">
          <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-[var(--text-4)] pointer-events-none" />
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Name or number"
            aria-label="Filter this run's numbers"
            className="pl-7 pr-6 py-1 w-[190px] text-[12px] rounded-[7px] bg-[var(--bg-elevated)] border border-[var(--border)] text-[var(--text-1)] placeholder:text-[var(--text-4)] focus:outline-none focus:border-primary"
          />
          {q && <button type="button" aria-label="Clear the filter" onClick={() => setQ("")} className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[var(--text-3)] hover:text-[var(--text-1)]"><X size={12} /></button>}
        </label>
        <StyledSelect size="sm" prefix="Deposited:" options={RUN_DEPOSITED} value={deposited} onChange={(v) => { setDeposited(v); setPage(1); }} placeholder="Any" />
        <StyledSelect size="sm" prefix="Contact:" options={RUN_CONTACT} value={contact} onChange={(v) => { setContact(v); setPage(1); }} placeholder="Any" />
        {error && <span className="text-[11px] text-amber-400 font-mono">{error}</span>}
        <span className="ml-auto font-mono text-[11px] text-[var(--text-4)]" aria-label="Numbers on this run">{data ? data.total.toLocaleString("en-US") : ""}</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[12px] border-collapse">
          <thead>
            <tr className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-3)]">
              <th className="text-left py-1.5 pr-3 font-semibold">Member</th>
              <SortHead label="Number" k="phone" sort={rSort.sort} dir={rSort.dir} onSort={sortBy} />
              <th className="text-left py-1.5 pr-3 font-semibold">Outcome</th>
              <SortHead label="Deposited after this run" k="amount" sort={rSort.sort} dir={rSort.dir} onSort={sortBy} right />
              <SortHead label="Attempted" k="last_contact" sort={rSort.sort} dir={rSort.dir} onSort={sortBy} right />
            </tr>
          </thead>
          <tbody>
            {!data ? (
              [0, 1, 2, 3, 4].map((i) => (
                <tr key={i} className="border-t border-[var(--border)]" aria-busy="true">
                  <td className="py-[6px] pr-3"><Pulse w={i % 2 ? "w-24" : "w-32"} /></td>
                  <td className="py-[6px] pr-3"><Pulse w="w-28" /></td>
                  <td className="py-[6px] pr-3"><Pulse w="w-16" h="h-4" className="rounded-full" /></td>
                  <td className="py-[6px] pr-3 text-right"><Pulse w="w-12" /></td>
                  <td className="py-[6px] text-right"><Pulse w="w-16" /></td>
                </tr>
              ))
            ) : rows.length === 0 ? (
              <tr><td colSpan={5} className="py-5 text-center text-xs text-[var(--text-3)] border-t border-[var(--border)]">{needle ? `No number matches “${needle}”. An empty result is an answer.` : filtered ? "No player on this run matches these filters. An empty result is an answer." : "No numbers on this run."}</td></tr>
            ) : (
              rows.map((r) => (
                <tr key={r.phone} className="border-t border-[var(--border)]">
                  <td className="py-[6px] pr-3 text-[var(--text-2)] truncate max-w-[220px]">{r.name ?? "—"}</td>
                  <td className="py-[6px] pr-3 font-mono text-[var(--text-1)] whitespace-nowrap">{r.phone}</td>
                  <td className="py-[6px] pr-3">
                    {r.outcome ? (
                      <span className="text-[10px] px-[7px] py-px rounded-full border whitespace-nowrap" style={{ color: DOT_COLOR[r.outcome], borderColor: DOT_COLOR[r.outcome] }}>{DOT_LABEL[r.outcome]}</span>
                    ) : (
                      <span className="text-[10px] px-[7px] py-px rounded-full border border-[var(--border-2)] text-[var(--text-4)] whitespace-nowrap">not dialled</span>
                    )}
                  </td>
                  <td className="py-[6px] pr-3 text-right font-mono text-[11px] whitespace-nowrap">
                    {r.depositsAfter > 0 ? (
                      <span className="text-[var(--text-1)]">EUR {r.depositsAfterEur.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}<small className="block text-[10px] text-[var(--text-4)]">{r.depositsAfter} deposit{r.depositsAfter === 1 ? "" : "s"} · from {mmddhm(r.firstDepositAfterAt)}</small></span>
                    ) : r.cioKnown ? (
                      <span className="text-[var(--text-4)]">—</span>
                    ) : (
                      <span className="text-[var(--text-4)] text-[10.5px]">no record</span>
                    )}
                  </td>
                  <td className="py-[6px] text-right font-mono text-[11px] text-[var(--text-4)] whitespace-nowrap">{mmddhm(r.lastAt)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {total > (data?.pageSize ?? 10) && (
        <div className="flex justify-end pt-2.5 mt-[11px] border-t border-[var(--border)]">
          <Pagination currentPage={page} totalPages={pages} totalItems={total} pageSize={data?.pageSize ?? 10} onPageChange={setPage} noun="numbers" />
        </div>
      )}
    </div>
  );
}
