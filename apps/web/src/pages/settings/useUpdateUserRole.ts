import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useFetcher } from "@/lib/api/context";
import { queryKeys } from "@/lib/queryKeys";
import { ADMIN_ENDPOINTS } from "@/lib/endpoints";

export function useUpdateUserRole() {
  const fetcher = useFetcher();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ userId, isAdmin }: { userId: string; isAdmin: boolean }) =>
      fetcher<{ success: boolean; user: { id: string; is_admin: boolean } }>(
        ADMIN_ENDPOINTS.UPDATE_USER_ROLE(userId),
        {
          method: "PATCH",
          body: { is_admin: isAdmin },
        },
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.admin.users(),
      });
    },
  });
}
