import { useQuery } from "@tanstack/react-query";
import { useFetcher } from "@/lib/api/context";
import { queryKeys } from "@/lib/queryKeys";
import { LIBRARY_ENDPOINTS } from "@/lib/endpoints";
import type { LibraryDownloadsResponse } from "@rawkoon/shared/types";

export function useLibraryDownloads(id: number | null) {
  const fetcher = useFetcher();

  return useQuery({
    queryKey: queryKeys.library.downloads(id ?? 0),
    queryFn: () =>
      fetcher<LibraryDownloadsResponse>(LIBRARY_ENDPOINTS.DOWNLOADS(id!)),
    enabled: id !== null,
    staleTime: 0,
    gcTime: 0,
    // Live progress arrives over SSE (see useLibraryEvents → download-progress),
    // which patches this cache in place. The mount fetch seeds the snapshot; no
    // client-side poll is needed.
  });
}
