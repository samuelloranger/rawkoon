import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useFetcher } from "@/lib/api/context";
import { queryKeys } from "@/lib/queryKeys";
import { LIBRARY_ENDPOINTS } from "@/lib/endpoints";
import type { LibraryScanResponse } from "@rawkoon/shared/types";

export function useLibraryScan() {
  const fetcher = useFetcher();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: { path: string; type: "movie" | "show" }) =>
      fetcher<LibraryScanResponse>(LIBRARY_ENDPOINTS.SCAN, {
        method: "POST",
        body,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.library.all });
    },
  });
}
