import { useQuery } from "@tanstack/react-query";
import { useFetcher } from "@/lib/api/context";
import { queryKeys } from "@/lib/queryKeys";
import { MEDIAS_ENDPOINTS } from "@/lib/endpoints";
import type { MissingCollectionsResponse } from "@rawkoon/shared/types";

export function useMissingCollections(options?: {
  enabled?: boolean;
  language?: string;
}) {
  const fetcher = useFetcher();
  const lang = options?.language ?? "en-US";
  return useQuery({
    queryKey: queryKeys.medias.missingCollections(lang),
    queryFn: () =>
      fetcher<MissingCollectionsResponse>(
        MEDIAS_ENDPOINTS.MISSING_COLLECTIONS(lang),
      ),
    enabled: options?.enabled ?? true,
    staleTime: 5 * 60 * 1000,
  });
}
