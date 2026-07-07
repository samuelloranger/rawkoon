import { useQuery } from "@tanstack/react-query";
import { useFetcher } from "@/lib/api/context";
import { queryKeys } from "@/lib/queryKeys";
import { ADMIN_ENDPOINTS } from "@/lib/endpoints";
import type { LibraryHealthResponse } from "@rawkoon/shared/types";

export function useLibraryHealth() {
  const fetcher = useFetcher();

  return useQuery({
    queryKey: queryKeys.admin.libraryHealth(),
    queryFn: () =>
      fetcher<LibraryHealthResponse>(ADMIN_ENDPOINTS.LIBRARY_HEALTH),
    refetchInterval: 45_000,
    refetchOnWindowFocus: true,
  });
}
