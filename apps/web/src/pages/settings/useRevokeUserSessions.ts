import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useFetcher } from "@/lib/api/context";
import { queryKeys } from "@/lib/queryKeys";
import { ADMIN_ENDPOINTS } from "@/lib/endpoints";
import type { RevokeSessionResponse } from "@rawkoon/shared/types";

export function useRevokeUserSessions() {
  const fetcher = useFetcher();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (userId: string) =>
      fetcher<RevokeSessionResponse>(
        ADMIN_ENDPOINTS.REVOKE_USER_SESSIONS(userId),
        { method: "DELETE" },
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.sessions() });
    },
  });
}
