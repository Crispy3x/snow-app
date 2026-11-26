import type { DirectoryListRow } from "./types";

/** Browse filters for /app/directory, read from the URL. Pure, unit tested. */

export type DirectoryFilters = {
  q: string;
  category: string;
  usWarehouse: boolean;
  dropship: boolean;
  maxHandling: number | null;
  favorites: boolean;
};

type Params = Record<string, string | string[] | undefined>;

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export function parseDirectoryFilters(params: Params): DirectoryFilters {
  const maxRaw = first(params.maxHandling).trim();
  const max = maxRaw === "" ? NaN : Number(maxRaw);
  return {
    q: first(params.q).trim().slice(0, 100),
    category: first(params.category).trim().slice(0, 40),
    usWarehouse: first(params.us) === "1",
    dropship: first(params.dropship) === "1",
    maxHandling: Number.isInteger(max) && max >= 0 && max <= 60 ? max : null,
    favorites: first(params.fav) === "1",
  };
}

export function hasActiveFilters(f: DirectoryFilters): boolean {
  return !!(f.q || f.category || f.usWarehouse || f.dropship || f.maxHandling !== null || f.favorites);
}

/** Every category used by the given suppliers, sorted, case-insensitively de-duplicated. */
export function categoriesOf(rows: Pick<DirectoryListRow, "categories">[]): string[] {
  const map = new Map<string, string>();
  for (const r of rows) for (const c of r.categories ?? []) if (!map.has(c.toLowerCase())) map.set(c.toLowerCase(), c);
  return [...map.values()].sort((a, b) => a.localeCompare(b));
}

export function filterDirectory<T extends DirectoryListRow>(rows: T[], f: DirectoryFilters, favoriteIds: ReadonlySet<string> = new Set()): T[] {
  const terms = f.q.toLowerCase().split(/\s+/).filter(Boolean);
  const cat = f.category.toLowerCase();
  return rows.filter((r) => {
    if (cat && !(r.categories ?? []).some((c) => c.toLowerCase() === cat)) return false;
    if (f.usWarehouse && !r.us_warehouse) return false;
    if (f.dropship && !r.accepts_dropship) return false;
    // Unknown handling time doesn't pass a max-handling filter: the seller can't rely on it.
    if (f.maxHandling !== null && (r.typical_handling_days === null || r.typical_handling_days > f.maxHandling)) return false;
    if (f.favorites && !favoriteIds.has(r.id)) return false;
    if (terms.length) {
      const hay = [r.name, r.description ?? "", r.ships_from ?? "", ...(r.categories ?? [])].join(" ").toLowerCase();
      if (!terms.every((t) => hay.includes(t))) return false;
    }
    return true;
  });
}

/** Admin order, then name. */
export function sortDirectory<T extends Pick<DirectoryListRow, "sort_order" | "name">>(rows: T[]): T[] {
  return [...rows].sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));
}
