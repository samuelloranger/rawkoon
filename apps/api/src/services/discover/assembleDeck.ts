import type {
  DiscoverDeckItem,
  DiscoverDeckResponse,
  DiscoverDeckSource,
} from "@rawkoon/shared/types";

/** Minimum owned titles before we personalize; below this we serve trending. */
export const MIN_SEEDS = 3;

interface AssembleInput {
  seedCount: number;
  seededCandidates: DiscoverDeckItem[];
  fallbackCandidates: DiscoverDeckItem[];
  excludedTmdbIds: Set<number>;
  limit: number;
}

/** Filters excluded ids and de-duplicates by tmdb_id, keeping first occurrence. */
function filterAndDedupe(
  items: DiscoverDeckItem[],
  excluded: Set<number>,
  seen: Set<number>,
): DiscoverDeckItem[] {
  const out: DiscoverDeckItem[] = [];
  for (const item of items) {
    if (excluded.has(item.tmdb_id) || seen.has(item.tmdb_id)) continue;
    seen.add(item.tmdb_id);
    out.push(item);
  }
  return out;
}

export function assembleDeck(input: AssembleInput): DiscoverDeckResponse {
  const seen = new Set<number>();
  const personalize = input.seedCount >= MIN_SEEDS;

  const primary = personalize
    ? filterAndDedupe(input.seededCandidates, input.excludedTmdbIds, seen)
    : filterAndDedupe(input.fallbackCandidates, input.excludedTmdbIds, seen);

  let deck = primary;
  if (deck.length < input.limit) {
    deck = deck.concat(
      filterAndDedupe(input.fallbackCandidates, input.excludedTmdbIds, seen),
    );
  }

  // Source is "personalized" only when the personalized path actually produced picks.
  const source: DiscoverDeckSource =
    personalize && primary.length > 0 ? "personalized" : "trending";

  return { items: deck.slice(0, input.limit), source };
}
