import { useQuery } from "@tanstack/react-query";
import { useFetcher } from "@/lib/api/context";
import { queryKeys } from "@/lib/queryKeys";
import { MEDIAS_ENDPOINTS } from "@/lib/endpoints";
import type { SimilarMediasResponse } from "@rawkoon/shared/types";

export function useSimilarMedias(
  tmdbId: number | null,
  type: "movie" | "tv" | null,
  language?: string,
  options?: { enabled?: boolean },
) {
  const fetcher = useFetcher();
  const lang = language || "en-US";
  const isEnabled =
    (options?.enabled ?? true) && tmdbId !== null && type !== null;

  return useQuery({
    queryKey: [...queryKeys.medias.similar(tmdbId ?? 0, type ?? "movie"), lang],
    queryFn: () =>
      fetcher<SimilarMediasResponse>(
        `${MEDIAS_ENDPOINTS.SIMILAR(tmdbId!, type!)}&language=${encodeURIComponent(lang)}`,
      ),
    enabled: isEnabled,
  });
}
