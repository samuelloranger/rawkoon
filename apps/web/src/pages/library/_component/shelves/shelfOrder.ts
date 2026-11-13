import type { ShelfEntryView } from "@rawkoon/shared/types";

/** Moves the item at `from` to index `to`; equal or out-of-range indices (a missing id's -1 too) leave the list as is. */
export function moveBefore<T>(
  list: readonly T[],
  from: number,
  to: number,
): T[] {
  const next = [...list];
  if (from === to || from < 0 || to < 0) return next;
  if (from >= next.length || to >= next.length) return next;
  next.splice(to, 0, next.splice(from, 1)[0]);
  return next;
}

/**
 * Moves a title. Group labels belong to positions, not titles, so each header
 * stays above the same slot and the titles after it, however the titles move.
 */
export function moveEntry(
  entries: readonly ShelfEntryView[],
  from: number,
  to: number,
): ShelfEntryView[] {
  return moveBefore(entries, from, to).map((entry, position) => ({
    ...entry,
    position,
    group_label: entries[position].group_label,
  }));
}

/** A header shows above an entry whose label differs from the previous entry's. */
export function startsGroup(
  entries: readonly ShelfEntryView[],
  index: number,
): boolean {
  const label = entries[index].group_label;
  return label != null && label !== entries[index - 1]?.group_label;
}

/**
 * Labels the entry at `index` and the rest of its group, so renaming a header
 * is one change. An empty label removes the header by joining the previous group.
 */
export function setGroupFrom(
  entries: readonly ShelfEntryView[],
  index: number,
  label: string,
): ShelfEntryView[] {
  if (!entries[index]) return [...entries];
  const old = entries[index].group_label;
  const next = label.trim() || (entries[index - 1]?.group_label ?? null);
  let end = index;
  while (end < entries.length && entries[end].group_label === old) end++;
  return entries.map((entry, i) =>
    i >= index && i < end ? { ...entry, group_label: next } : entry,
  );
}
