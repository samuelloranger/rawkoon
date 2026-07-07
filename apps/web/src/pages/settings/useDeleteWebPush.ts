import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useFetcher } from "@/lib/api/context";
import { queryKeys } from "@/lib/queryKeys";
import { ADMIN_ENDPOINTS } from "@/lib/endpoints";
import type { DeleteWebPushResponse } from "@rawkoon/shared/types";

export function useDeleteWebPush() {
  const fetcher = useFetcher();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: number) =>
      fetcher<DeleteWebPushResponse>(ADMIN_ENDPOINTS.DELETE_WEB_PUSH(id), {
        method: "DELETE",
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.webPush() });
    },
  });
}
