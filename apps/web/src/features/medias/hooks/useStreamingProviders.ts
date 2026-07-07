import { useQuery } from "@tanstack/react-query";
import { useFetcher } from "@/lib/api/context";
import { queryKeys } from "@/lib/queryKeys";
import { MEDIAS_ENDPOINTS } from "@/lib/endpoints";
import type { TmdbStreamingProvidersResponse } from "@rawkoon/shared/types";

export function useStreamingProviders(
  type?: "movie" | "tv",
  language?: string,
) {
  const fetcher = useFetcher();
  const lang = language ?? "en-US";
  return useQuery({
    queryKey: queryKeys.medias.streamingProviders(type, lang),
    queryFn: () =>
      fetcher<TmdbStreamingProvidersResponse>(
        MEDIAS_ENDPOINTS.STREAMING_PROVIDERS(type, lang),
      ),
    staleTime: 24 * 60 * 60 * 1000,
  });
}
