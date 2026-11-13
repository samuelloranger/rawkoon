import type { ShelfLookupItem, ShelfRules } from "@rawkoon/shared/types";
import { getJsonCache, setJsonCache } from "@rawkoon/api/services/cache";
import { tmdbApiFetch } from "@rawkoon/api/utils/medias/libraryHelpers";
import type { NameKind, NameOf } from "./shelfReasons";
import { fetchShelfTmdbKey } from "./shelfTmdb";

const LOOKUP_CONCURRENCY = 5;

const SEARCH_TTL = 60 * 60;
const GENRE_TTL = 24 * 60 * 60;

// Keyword, company, network and collection names never change under an id, so
// they live for the process; a failed lookup is not stored and retries.
const names = new Map<string, string>();

const asItems = (list: unknown): ShelfLookupItem[] =>
  Array.isArray(list)
    ? list.flatMap((raw) => {
        const item = raw as { id?: unknown; name?: unknown };
        return typeof item.id === "number" && typeof item.name === "string"
          ? [{ id: item.id, name: item.name }]
          : [];
      })
    : [];

/** Thin cached TMDB search for the rules editor's keyword and company pickers. */
export async function searchLookup(
  kind: "keyword" | "company",
  query: string,
): Promise<ShelfLookupItem[] | null> {
  const q = query.trim();
  if (!q) return [];
  const cacheKey = `shelves:lookup:${kind}:${q.toLowerCase()}`;
  const cached = await getJsonCache<ShelfLookupItem[]>(cacheKey);
  if (cached) return cached;
  const apiKey = await fetchShelfTmdbKey();
  if (!apiKey) return null;
  const raw = await tmdbApiFetch<{ results?: unknown }>(
    `search/${kind}`,
    apiKey,
    { query: q },
  );
  const items = asItems(raw.results).slice(0, 20);
  await setJsonCache(cacheKey, items, SEARCH_TTL);
  for (const item of items) names.set(`${kind}:${item.id}`, item.name);
  return items;
}

/** TMDB genre names for movies and shows in one map (the ids are shared), en-US. */
async function genreNames(apiKey: string): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  for (const type of ["movie", "tv"]) {
    // The same key and shape as the medias genre route, so the two share a cache entry
    const cacheKey = `medias:genres:${type}:en-US`;
    let list = await getJsonCache<ShelfLookupItem[]>(cacheKey);
    if (!list) {
      const raw = await tmdbApiFetch<{ genres?: unknown }>(
        `genre/${type}/list`,
        apiKey,
        { language: "en-US" },
      );
      list = asItems(raw.genres);
      await setJsonCache(cacheKey, list, GENRE_TTL);
    }
    for (const genre of list) out.set(genre.id, genre.name);
  }
  return out;
}

const ENDPOINT: Record<Exclude<NameKind, "genre">, string> = {
  keyword: "keyword",
  company: "company",
  network: "network",
  collection: "collection",
};

/**
 * Names for every id a set of rules mentions, resolved up front so reasons can be
 * built synchronously. An id TMDB can't name falls back to the number.
 */
export async function loadRuleNames(rules: ShelfRules): Promise<NameOf> {
  const wanted: Array<[NameKind, number]> = [
    ...(rules.genres_any ?? []),
    ...(rules.genres_none ?? []),
  ].map((id) => ["genre", id] as [NameKind, number]);
  for (const [kind, ids] of [
    [
      "keyword",
      [...(rules.keywords_any ?? []), ...(rules.keywords_none ?? [])],
    ],
    ["company", rules.companies_any ?? []],
    ["network", rules.networks_any ?? []],
    [
      "collection",
      rules.tmdb_collection != null ? [rules.tmdb_collection] : [],
    ],
  ] as Array<[NameKind, number[]]>) {
    for (const id of ids) wanted.push([kind, id]);
  }
  const apiKey = wanted.length ? await fetchShelfTmdbKey() : null;
  const genres = new Map<number, string>();
  if (apiKey && wanted.some(([kind]) => kind === "genre")) {
    try {
      for (const [id, name] of await genreNames(apiKey)) genres.set(id, name);
    } catch {
      // Falls back to ids below
    }
  }
  if (apiKey) {
    const missing = wanted.filter(
      ([kind, id]) => kind !== "genre" && !names.has(`${kind}:${id}`),
    );
    // A few at a time: a preview can name ~200 ids, which would trip TMDB's rate limit at once
    for (let i = 0; i < missing.length; i += LOOKUP_CONCURRENCY) {
      await Promise.all(
        missing.slice(i, i + LOOKUP_CONCURRENCY).map(async ([kind, id]) => {
          try {
            const raw = await tmdbApiFetch<{ name?: unknown }>(
              `${ENDPOINT[kind as Exclude<NameKind, "genre">]}/${id}`,
              apiKey,
            );
            if (typeof raw.name === "string")
              names.set(`${kind}:${id}`, raw.name);
          } catch {
            // Falls back to the id below
          }
        }),
      );
    }
  }
  return (kind, id) =>
    (kind === "genre" ? genres.get(id) : names.get(`${kind}:${id}`)) ??
    String(id);
}
