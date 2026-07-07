import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useFetcher } from "@/lib/api/context";
import { queryKeys } from "@/lib/queryKeys";
import { LIBRARY_ENDPOINTS } from "@/lib/endpoints";
import type { LibraryListResponse } from "@rawkoon/shared/types";

export function useLibrary(
  filters?: {
    type?: string;
    status?: string;
    q?: string;
    language?: string;
  },
  options?: { staleTime?: number; gcTime?: number },
) {
  const fetcher = useFetcher();

  const params = new URLSearchParams();
  if (filters?.type) params.set("type", filters.type);
  if (filters?.status) params.set("status", filters.status);
  if (filters?.q) params.set("q", filters.q);
  if (filters?.language) params.set("language", filters.language);
  const qs = params.toString();

  return useQuery({
    queryKey: queryKeys.library.list(filters),
    queryFn: () =>
      fetcher<LibraryListResponse>(
        `${LIBRARY_ENDPOINTS.LIST}${qs ? `?${qs}` : ""}`,
      ),
    placeholderData: keepPreviousData,
    ...options,
  });
}
