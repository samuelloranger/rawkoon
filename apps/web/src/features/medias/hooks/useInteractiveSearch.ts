import { useQuery } from "@tanstack/react-query";
import { useFetcher } from "@/lib/api/context";
import { queryKeys } from "@/lib/queryKeys";
import { MEDIAS_ENDPOINTS } from "@/lib/endpoints";
import type { MediaInteractiveSearchResponse } from "@rawkoon/shared/types";

export function useInteractiveSearch(
  query: string,
  options?: {
    enabled?: boolean;
    library_media_id?: number | null;
    /** When set to a number, triggers tvsearch for that season. "complete" triggers full-series search. */
    season?: number | "complete" | null;
    /** TMDB ID — used for tier-1 structured tvsearch and result validation */
    tmdb_id?: number | null;
    /** Media type — used for category filtering (movie vs TV) */
    media_type?: "movie" | "tv" | null;
  },
) {
  const fetcher = useFetcher();
  const trimmed = query.trim();
  const libId = options?.library_media_id;
  const season = options?.season ?? null;
  const tmdbId = options?.tmdb_id ?? null;
  const isSeasonSearch = typeof season === "number";
  const isCompleteSearch = season === "complete";

  return useQuery({
    queryKey: queryKeys.medias.interactiveSearch(trimmed, libId, season),
    queryFn: () =>
      fetcher<MediaInteractiveSearchResponse>(
        MEDIAS_ENDPOINTS.INTERACTIVE_SEARCH,
        {
          params: {
            q: trimmed,
            ...(libId != null && libId > 0 ? { library_media_id: libId } : {}),
            ...(isSeasonSearch ? { season } : {}),
            ...(isCompleteSearch ? { complete: "true" } : {}),
            ...(tmdbId != null ? { tmdb_id: tmdbId } : {}),
            ...(options?.media_type ? { media_type: options.media_type } : {}),
          },
        },
      ),
    enabled:
      (options?.enabled ?? true) &&
      (isSeasonSearch || isCompleteSearch
        ? trimmed.length >= 1
        : trimmed.length >= 2),
  });
}
