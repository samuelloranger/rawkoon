import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useFetcher } from "@/lib/api/context";
import { queryKeys } from "@/lib/queryKeys";
import { ADMIN_ENDPOINTS } from "@/lib/endpoints";
import type { TriggerActionResponse } from "@rawkoon/shared/types";

export function useTriggerAction() {
  const fetcher = useFetcher();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (action: string) =>
      fetcher<TriggerActionResponse>(ADMIN_ENDPOINTS.TRIGGER_ACTION, {
        method: "POST",
        body: { action },
      }),
    onSuccess: (_data, action) => {
      if (action === "check_library_integrity") {
        queryClient.invalidateQueries({
          queryKey: queryKeys.admin.libraryHealth(),
        });
      }
      if (action === "sync_library_attention_alerts") {
        queryClient.invalidateQueries({
          queryKey: queryKeys.library.attention(),
        });
      }
    },
  });
}
