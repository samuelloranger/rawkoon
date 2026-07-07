import { useQuery } from "@tanstack/react-query";
import { useFetcher } from "@/lib/api/context";
import { queryKeys } from "@/lib/queryKeys";
import { MEDIAS_ENDPOINTS } from "@/lib/endpoints";
import type { TmdbGenresResponse } from "@rawkoon/shared/types";

export function useMediaGenres(type: "movie" | "tv", language?: string) {
  const fetcher = useFetcher();
  const lang = language ?? "en-US";

  return useQuery({
    queryKey: queryKeys.medias.genres(type, lang),
    queryFn: () =>
      fetcher<TmdbGenresResponse>(MEDIAS_ENDPOINTS.GENRES(type, lang)),
    staleTime: 24 * 60 * 60 * 1000,
  });
}
