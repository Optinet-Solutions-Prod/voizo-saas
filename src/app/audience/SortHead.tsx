"use client";

// A sortable column header for the Audience tables (Jasiel 2026-09-07: "sorting in the columns"), the
// dashboard's convention: click the header, an arrow marks the active key and its direction, a second
// click flips it. `aria-sort` carries the state for screen readers. The caller owns the state and the
// flip rule; this only draws and reports the click.
export type SortDir = "asc" | "desc";

/** The clickable label alone, for headers that are not table cells (the family rows are buttons). */
export function SortButton<K extends string>({ label, k, sort, dir, onSort, title }: {
  label: string;
  k: K;
  sort: K;
  dir: SortDir;
  onSort: (k: K) => void;
  title?: string;
}) {
  const active = sort === k;
  return (
    <button
      type="button"
      onClick={() => onSort(k)}
      title={title ?? `Sort by ${label.toLowerCase()}`}
      aria-pressed={active}
      className={`group inline-flex items-center gap-1 uppercase tracking-wider text-[10px] font-semibold transition-colors ${active ? "text-[var(--text-1)]" : "text-[var(--text-3)] hover:text-[var(--text-2)]"}`}
    >
      {label}
      <span aria-hidden className={`text-[8px] ${active ? "text-primary" : "text-[var(--text-4)] opacity-0 group-hover:opacity-70"}`}>
        {active && dir === "asc" ? "▲" : "▼"}
      </span>
    </button>
  );
}

export default function SortHead<K extends string>({ label, k, sort, dir, onSort, right, first, title }: {
  label: string;
  k: K;
  sort: K;
  dir: SortDir;
  onSort: (k: K) => void;
  right?: boolean;
  /** The first column carries the table's wider left padding. */
  first?: boolean;
  title?: string;
}) {
  const active = sort === k;
  return (
    <th
      aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : "none"}
      className={`${right ? "text-right" : "text-left"} ${first ? "px-4" : "px-3"} py-2 font-semibold whitespace-nowrap`}
    >
      <SortButton label={label} k={k} sort={sort} dir={dir} onSort={onSort} title={title} />
    </th>
  );
}

/** The flip rule shared by the Audience tables: a new key starts descending (newest, largest first),
 *  except phone, which reads naturally ascending; the same key flips. */
export function nextSort<K extends string>(current: { sort: K; dir: SortDir }, k: K, ascFirst: readonly K[] = []): { sort: K; dir: SortDir } {
  if (current.sort === k) return { sort: k, dir: current.dir === "asc" ? "desc" : "asc" };
  return { sort: k, dir: ascFirst.includes(k) ? "asc" : "desc" };
}
