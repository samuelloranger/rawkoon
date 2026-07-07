import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useFetcher } from "@/lib/api/context";
import { queryKeys } from "@/lib/queryKeys";
import { LIBRARY_ENDPOINTS } from "@/lib/endpoints";

export function useDismissLibraryAttentionAlert() {
  const fetcher = useFetcher();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (alertId: number) =>
      fetcher<{ success: boolean }>(
        LIBRARY_ENDPOINTS.DISMISS_ATTENTION(alertId),
        { method: "PATCH" },
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.library.attention(),
      });
    },
  });
}
