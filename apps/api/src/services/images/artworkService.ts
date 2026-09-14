import { createHash } from "node:crypto";
import type {
  ArtworkCandidate,
  ArtworkKind,
  ArtworkSource,
} from "@rawkoon/shared/types";
import { getJsonCache, setJsonCache } from "@rawkoon/api/services/cache";
import { getLibraryTmdbApiKey } from "@rawkoon/api/utils/medias/libraryHelpers";
import { fetchTmdbArtwork } from "@rawkoon/api/services/images/tmdbImageProvider";
import { fetchFanartArtwork } from "@rawkoon/api/services/images/fanartProvider";
import { fetchMediaDetails } from "@rawkoon/api/utils/medias/tmdbFetcherDetails";
import { getIntegrationConfigRecord } from "@rawkoon/api/services/integrationConfigCache";
import { normalizeFanartConfig } from "@rawkoon/api/utils/integrations/normalizers";

const CACHE_TTL_SECONDS = 60 * 60 * 6;

/**
 * TMDB votes (0-10) and fanart likes (unbounded counts) are not comparable, so
 * each source is sorted on its own scale and TMDB is listed first.
 */
export function mergeArtworkCandidates(
  lists: ArtworkCandidate[][],
): ArtworkCandidate[] {
  const bySource = (source: ArtworkSource) =>
    lists
      .flat()
      .filter((c) => c.source === source)
      .sort((a, b) => (b.vote ?? -1) - (a.vote ?? -1));

  const seen = new Set<string>();
  const out: ArtworkCandidate[] = [];
  for (const candidate of [...bySource("tmdb"), ...bySource("fanart")]) {
    if (seen.has(candidate.url)) continue;
    seen.add(candidate.url);
    out.push(candidate);
  }
  return out;
}

/** Every poster or backdrop the configured sources know about, cached. */
export async function getArtworkCandidates(input: {
  tmdbId: number;
  mediaType: "movie" | "tv";
  kind: ArtworkKind;
}): Promise<ArtworkCandidate[]> {
  const fanartIntegration = await getIntegrationConfigRecord("fanart");
  const fanartKey = fanartIntegration?.enabled
    ? normalizeFanartConfig(fanartIntegration.config)?.api_key
    : null;
  // A changed or disabled key must not reuse a six-hour candidate list from
  // the previous integration state. Hash the secret before using it in a key.
  const fanartVersion = fanartKey
    ? createHash("sha256").update(fanartKey).digest("hex").slice(0, 16)
    : "off";
  const cacheKey = `medias:artwork-v2:${input.mediaType}:${input.tmdbId}:${input.kind}:${fanartVersion}`;
  const cached = await getJsonCache<ArtworkCandidate[]>(cacheKey);
  if (cached) return cached;

  const apiKey = await getLibraryTmdbApiKey();
  if (!apiKey) return [];

  // Shows need a TVDB id for fanart; it rides along on the cached details call.
  const details =
    input.mediaType === "tv"
      ? await fetchMediaDetails(apiKey, "tv", input.tmdbId)
      : null;
  const providerId =
    input.mediaType === "movie"
      ? input.tmdbId
      : (details?.external_ids?.tvdb_id ?? null);

  const [tmdb, fanart] = await Promise.all([
    fetchTmdbArtwork({
      apiKey,
      mediaType: input.mediaType,
      tmdbId: input.tmdbId,
      kind: input.kind,
    }),
    fetchFanartArtwork({
      mediaType: input.mediaType,
      providerId,
      kind: input.kind,
    }),
  ]);

  const merged = mergeArtworkCandidates([tmdb, fanart]);
  await setJsonCache(cacheKey, merged, CACHE_TTL_SECONDS);
  return merged;
}
