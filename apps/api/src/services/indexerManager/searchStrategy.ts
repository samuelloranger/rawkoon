import type {
  IndexerManagerAdapter,
  IndexerWarning,
  NormalizedRelease,
  SearchResult,
} from "./types";

interface TieredSearchOpts {
  query: string;
  tmdbId?: number | null;
  season?: number | null;
  complete?: boolean;
  mediaType?: "movie" | "tv";
}

export async function tieredSearch(
  adapter: IndexerManagerAdapter,
  opts: TieredSearchOpts,
): Promise<SearchResult> {
  const { query, tmdbId, season, complete, mediaType } = opts;

  if (complete) {
    return completeSeriesSearch(adapter, query, tmdbId, mediaType);
  }

  if (season != null) {
    return seasonSearch(adapter, query, tmdbId, season, mediaType);
  }

  return adapter.search({ query, type: "freetext", mediaType });
}

async function seasonSearch(
  adapter: IndexerManagerAdapter,
  query: string,
  tmdbId: number | null | undefined,
  season: number,
  mediaType?: "movie" | "tv",
): Promise<SearchResult> {
  const sN = String(season).padStart(2, "0");
  const mt = mediaType ?? "tv";

  const results = await Promise.all([
    tmdbId != null
      ? adapter.search({ type: "tvsearch", tmdbId, season, mediaType: mt })
      : Promise.resolve({
          releases: [],
          indexerWarnings: [],
        } satisfies SearchResult),
    adapter.search({ type: "tvsearch", query, season, mediaType: mt }),
    adapter.search({
      type: "freetext",
      query: `${query} Season ${season}`,
      mediaType: mt,
    }),
    adapter.search({
      type: "freetext",
      query: `${query} Saison ${season}`,
      mediaType: mt,
    }),
    adapter.search({
      type: "freetext",
      query: `${query} S${sN}`,
      mediaType: mt,
    }),
  ]);

  return mergeResults(results);
}

async function completeSeriesSearch(
  adapter: IndexerManagerAdapter,
  query: string,
  tmdbId: number | null | undefined,
  mediaType?: "movie" | "tv",
): Promise<SearchResult> {
  const mt = mediaType ?? "tv";

  const results = await Promise.all([
    tmdbId != null
      ? adapter.search({ type: "tvsearch", tmdbId, mediaType: mt })
      : Promise.resolve({
          releases: [],
          indexerWarnings: [],
        } satisfies SearchResult),
    adapter.search({ type: "tvsearch", query, mediaType: mt }),
    adapter.search({
      type: "freetext",
      query: `${query} integrale`,
      mediaType: mt,
    }),
    adapter.search({
      type: "freetext",
      query: `${query} complete series`,
      mediaType: mt,
    }),
  ]);

  return mergeResults(results);
}

function mergeResults(results: SearchResult[]): SearchResult {
  const seen = new Set<string>();
  const releases: NormalizedRelease[] = [];
  for (const { releases: batch } of results) {
    for (const r of batch) {
      if (r.guid && !seen.has(r.guid)) {
        seen.add(r.guid);
        releases.push(r);
      }
    }
  }

  const warningSeen = new Set<string>();
  const indexerWarnings: IndexerWarning[] = [];
  for (const { indexerWarnings: batch } of results) {
    for (const w of batch) {
      if (!warningSeen.has(w.id)) {
        warningSeen.add(w.id);
        indexerWarnings.push(w);
      }
    }
  }

  return { releases, indexerWarnings };
}
