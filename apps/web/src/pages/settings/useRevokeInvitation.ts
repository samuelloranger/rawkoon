import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useFetcher } from "@/lib/api/context";
import { queryKeys } from "@/lib/queryKeys";
import { ADMIN_ENDPOINTS } from "@/lib/endpoints";
import type { RevokeInvitationResponse } from "@rawkoon/shared/types";

export function useRevokeInvitation() {
  const fetcher = useFetcher();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: number) =>
      fetcher<RevokeInvitationResponse>(ADMIN_ENDPOINTS.REVOKE_INVITATION(id), {
        method: "DELETE",
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.admin.invitations(),
      });
    },
  });
}
