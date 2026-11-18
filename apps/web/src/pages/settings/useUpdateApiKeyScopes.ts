import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useFetcher } from "@/lib/api/context";
import { queryKeys } from "@/lib/queryKeys";
import { ADMIN_ENDPOINTS } from "@/lib/endpoints";
import type {
  McpScope,
  UpdateApiKeyScopesRequest,
  UpdateApiKeyScopesResponse,
} from "@rawkoon/shared/types";

export function useUpdateApiKeyScopes() {
  const fetcher = useFetcher();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (vars: { id: string; scopes: McpScope[] }) =>
      fetcher<UpdateApiKeyScopesResponse>(
        ADMIN_ENDPOINTS.PATCH_API_KEY(vars.id),
        {
          method: "PATCH",
          body: { mcp_scopes: vars.scopes } satisfies UpdateApiKeyScopesRequest,
        },
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.apiKeys() });
    },
  });
}
