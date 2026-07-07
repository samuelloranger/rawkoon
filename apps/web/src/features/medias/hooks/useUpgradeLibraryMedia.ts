import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useFetcher } from "@/lib/api/context";
import { queryKeys } from "@/lib/queryKeys";
import { LIBRARY_ENDPOINTS } from "@/lib/endpoints";

export function useUpgradeLibraryMedia() {
  const fetcher = useFetcher();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, mode }: { id: number; mode: "auto" | "manual" }) =>
      fetcher<{ queued: boolean; mode: string; count?: number }>(
        LIBRARY_ENDPOINTS.UPGRADE(id),
        { method: "POST", body: { mode } },
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.library.all });
    },
  });
}
