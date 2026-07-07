import { useQuery } from "@tanstack/react-query";
import { useFetcher } from "@/lib/api/context";
import { queryKeys } from "@/lib/queryKeys";
import { LIBRARY_ENDPOINTS } from "@/lib/endpoints";
import type { LibraryAttentionResponse } from "@rawkoon/shared/types";

export function useLibraryAttention(opts?: { enabled?: boolean }) {
  const fetcher = useFetcher();
  return useQuery({
    queryKey: queryKeys.library.attention(),
    queryFn: () =>
      fetcher<LibraryAttentionResponse>(LIBRARY_ENDPOINTS.ATTENTION),
    enabled: opts?.enabled ?? true,
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: true,
  });
}
