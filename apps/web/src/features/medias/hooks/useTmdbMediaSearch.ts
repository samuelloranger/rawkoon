import { useQuery } from "@tanstack/react-query";
import { useFetcher } from "@/lib/api/context";
import { queryKeys } from "@/lib/queryKeys";
import { MEDIAS_ENDPOINTS } from "@/lib/endpoints";
import type { TmdbMediaSearchResponse } from "@rawkoon/shared/types";

export function useTmdbMediaSearch(
  query: string,
  options?: {
    enabled?: boolean;
    language?: string;
    kind?: "movie" | "tv";
  },
) {
  const fetcher = useFetcher();
  const trimmed = query.trim();
  const lang = options?.language ?? "en-US";
  const kind = options?.kind;

  return useQuery({
    queryKey: queryKeys.medias.tmdbSearch(trimmed, lang, kind ?? "any"),
    queryFn: () =>
      fetcher<TmdbMediaSearchResponse>(
        MEDIAS_ENDPOINTS.TMDB_SEARCH(trimmed, lang, kind),
      ),
    enabled: (options?.enabled ?? true) && trimmed.length >= 2,
  });
}
