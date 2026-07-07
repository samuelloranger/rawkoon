import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useFetcher } from "@/lib/api/context";
import { queryKeys } from "@/lib/queryKeys";
import { ADMIN_ENDPOINTS } from "@/lib/endpoints";
import type {
  InviteUserRequest,
  InviteUserResponse,
} from "@rawkoon/shared/types";

export function useInviteUser() {
  const fetcher = useFetcher();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: InviteUserRequest) =>
      fetcher<InviteUserResponse>(ADMIN_ENDPOINTS.INVITE_USER, {
        method: "POST",
        body: data,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.admin.invitations(),
      });
    },
  });
}
