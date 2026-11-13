import type { ShelfOrderMode } from "@rawkoon/shared/types";

const MM_DD = /^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

/** A `MM-DD` day, or null for "no bound". */
export function normalizeMmdd(value: unknown): string | null {
  if (value == null || value === "") return null;
  if (typeof value !== "string" || !MM_DD.test(value)) return null;
  return value;
}

export function isValidMmdd(value: string): boolean {
  return MM_DD.test(value);
}

/** Today as `MM-DD` in the server's time zone, which is the shared reference for every client. */
export function todayMmdd(now = new Date()): string {
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${month}-${day}`;
}

/**
 * Whether a shelf is inside its yearly window today. Both bounds are inclusive
 * and a window may wrap the year end (`11-01` → `01-15`).
 */
export function isVisibleNow(
  from: string | null,
  to: string | null,
  now = new Date(),
): boolean {
  if (!from && !to) return true;
  const today = todayMmdd(now);
  if (from && to) {
    return from <= to
      ? today >= from && today <= to
      : today >= from || today <= to;
  }
  return from ? today >= from : today <= (to as string);
}

/** A grapheme-free comparison is enough for sorting titles here. */
const byTitle = (a: { title: string }, b: { title: string }) =>
  a.title.localeCompare(b.title);

type Orderable = {
  id: number;
  position: number;
  title: string;
  year: number | null;
  addedAt: Date | string;
};

const byRelease = (a: Orderable, b: Orderable) => {
  const ay = a.year ?? Number.MAX_SAFE_INTEGER;
  const by = b.year ?? Number.MAX_SAFE_INTEGER;
  if (ay !== by) return ay - by;
  const title = byTitle(a, b);
  return title !== 0 ? title : a.id - b.id;
};

/**
 * Display order for a shelf's entries. `rating` falls back to release until
 * title facts exist; `added` is newest first.
 */
export function sortEntries<T extends Orderable>(
  mode: ShelfOrderMode,
  entries: T[],
): T[] {
  const copy = [...entries];
  switch (mode) {
    case "release":
    case "rating":
      return copy.sort(byRelease);
    case "added":
      return copy.sort((a, b) => {
        const at = new Date(a.addedAt).getTime();
        const bt = new Date(b.addedAt).getTime();
        return at === bt ? b.id - a.id : bt - at;
      });
    default:
      return copy.sort((a, b) =>
        a.position === b.position ? a.id - b.id : a.position - b.position,
      );
  }
}
