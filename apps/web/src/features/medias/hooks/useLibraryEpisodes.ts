import { useQuery } from "@tanstack/react-query";
import { useFetcher } from "@/lib/api/context";
import { queryKeys } from "@/lib/queryKeys";
import { LIBRARY_ENDPOINTS } from "@/lib/endpoints";
import type { LibraryEpisodesResponse } from "@rawkoon/shared/types";

export function useLibraryEpisodes(id: number | null) {
  const fetcher = useFetcher();

  return useQuery({
    queryKey: queryKeys.library.episodes(id ?? 0),
    queryFn: () =>
      fetcher<LibraryEpisodesResponse>(LIBRARY_ENDPOINTS.EPISODES(id!)),
    enabled: id !== null,
    staleTime: 0,
    gcTime: 0,
  });
}
