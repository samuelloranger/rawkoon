import type { DiscoverDeckItem } from "@rawkoon/shared/types";

/** Appends incoming items that are neither already queued nor already served. */
export function mergeBatch(
  queue: DiscoverDeckItem[],
  served: Set<number>,
  incoming: DiscoverDeckItem[],
): DiscoverDeckItem[] {
  const present = new Set<number>([...served, ...queue.map((i) => i.tmdb_id)]);
  const additions: DiscoverDeckItem[] = [];
  for (const item of incoming) {
    if (present.has(item.tmdb_id)) continue;
    present.add(item.tmdb_id);
    additions.push(item);
  }
  return additions.length ? [...queue, ...additions] : queue;
}
