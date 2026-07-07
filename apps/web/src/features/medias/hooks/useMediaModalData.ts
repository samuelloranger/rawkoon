import { useQuery } from "@tanstack/react-query";
import { useFetcher } from "@/lib/api/context";
import { queryKeys } from "@/lib/queryKeys";
import { MEDIAS_ENDPOINTS } from "@/lib/endpoints";
import type { MediaModalDataResponse } from "@rawkoon/shared/types";

export function useMediaModalData(
  mediaType: "movie" | "tv" | null,
  tmdbId: number | null,
  options?: { enabled?: boolean },
  language?: string,
) {
  const fetcher = useFetcher();
  const isEnabled =
    (options?.enabled ?? true) &&
    mediaType !== null &&
    tmdbId !== null &&
    tmdbId > 0;
  return useQuery({
    queryKey: queryKeys.medias.modalData(
      mediaType ?? "movie",
      tmdbId ?? 0,
      language,
    ),
    queryFn: () =>
      fetcher<MediaModalDataResponse>(
        MEDIAS_ENDPOINTS.MODAL_DATA(mediaType!, tmdbId!, language),
      ),
    enabled: isEnabled,
    staleTime: 60 * 1000, // 1 min — watchlist status is user-specific
  });
}
