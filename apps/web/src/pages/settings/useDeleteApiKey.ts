import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useFetcher } from "@/lib/api/context";
import { queryKeys } from "@/lib/queryKeys";
import { ADMIN_ENDPOINTS } from "@/lib/endpoints";
import type { DeleteApiKeyResponse } from "@rawkoon/shared/types";

export function useDeleteApiKey() {
  const fetcher = useFetcher();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) =>
      fetcher<DeleteApiKeyResponse>(ADMIN_ENDPOINTS.DELETE_API_KEY(id), {
        method: "DELETE",
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.apiKeys() });
    },
  });
}
