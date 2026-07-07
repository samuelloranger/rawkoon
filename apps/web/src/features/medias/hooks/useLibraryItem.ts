import { useQuery } from "@tanstack/react-query";
import { useFetcher } from "@/lib/api/context";
import { queryKeys } from "@/lib/queryKeys";
import { LIBRARY_ENDPOINTS } from "@/lib/endpoints";
import type { LibraryItemResponse } from "@rawkoon/shared/types";

// Source of truth for the library detail page (fetch one item by id).
export function useLibraryItem(
  id: number,
  options?: { staleTime?: number; gcTime?: number },
) {
  const fetcher = useFetcher();

  return useQuery({
    queryKey: queryKeys.library.item(id),
    queryFn: () => fetcher<LibraryItemResponse>(LIBRARY_ENDPOINTS.ITEM(id)),
    enabled: Number.isFinite(id),
    // Overrides the global refetchOnMount:false so a stale cached entry self-heals on open.
    refetchOnMount: "always",
    ...options,
  });
}
