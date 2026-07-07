import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useFetcher } from "@/lib/api/context";
import { queryKeys } from "@/lib/queryKeys";
import { ADMIN_ENDPOINTS } from "@/lib/endpoints";
import type {
  CreateApiKeyRequest,
  CreateApiKeyResponse,
} from "@rawkoon/shared/types";

export function useCreateApiKey() {
  const fetcher = useFetcher();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateApiKeyRequest) =>
      fetcher<CreateApiKeyResponse>(ADMIN_ENDPOINTS.API_KEYS, {
        method: "POST",
        body: data,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.apiKeys() });
    },
  });
}
