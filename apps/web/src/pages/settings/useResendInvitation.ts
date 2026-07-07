import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useFetcher } from "@/lib/api/context";
import { queryKeys } from "@/lib/queryKeys";
import { ADMIN_ENDPOINTS } from "@/lib/endpoints";
import type { ResendInvitationResponse } from "@rawkoon/shared/types";

export function useResendInvitation() {
  const fetcher = useFetcher();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: number) =>
      fetcher<ResendInvitationResponse>(ADMIN_ENDPOINTS.RESEND_INVITATION(id), {
        method: "POST",
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.admin.invitations(),
      });
    },
  });
}
