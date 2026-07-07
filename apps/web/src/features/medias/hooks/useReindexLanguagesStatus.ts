import { useQuery } from "@tanstack/react-query";
import { useFetcher } from "@/lib/api/context";
import { queryKeys } from "@/lib/queryKeys";
import { LIBRARY_ENDPOINTS } from "@/lib/endpoints";
import type { ReindexLanguagesStatus } from "./useReindexLanguages";

export function useReindexLanguagesStatus(enabled = true) {
  const fetcher = useFetcher();
  return useQuery({
    queryKey: queryKeys.library.reindexLanguagesStatus(),
    queryFn: () =>
      fetcher<ReindexLanguagesStatus>(
        LIBRARY_ENDPOINTS.REINDEX_LANGUAGES_STATUS,
      ),
    enabled,
    refetchInterval: (query) => {
      const state = query.state.data?.state;
      return state === "active" || state === "waiting" ? 2000 : false;
    },
  });
}
