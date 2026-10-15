import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useFetcher } from "@/lib/api/context";
import { queryKeys } from "@/lib/queryKeys";
import { ADMIN_ENDPOINTS } from "@/lib/endpoints";
import type { ListJellyfinUsersResponse } from "@rawkoon/shared/types";

/** Fails (503) when the Jellyfin integration is off; callers hide the column then. */
export function useJellyfinUsers() {
  const fetcher = useFetcher();

  return useQuery({
    queryKey: queryKeys.admin.jellyfinUsers(),
    queryFn: () =>
      fetcher<ListJellyfinUsersResponse>(ADMIN_ENDPOINTS.JELLYFIN_USERS),
    retry: false,
  });
}

export function useLinkJellyfinUser() {
  const fetcher = useFetcher();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      userId,
      jellyfinUserId,
    }: {
      userId: string;
      jellyfinUserId: string | null;
    }) =>
      fetcher<{ success: boolean; jellyfin_user_id: string | null }>(
        ADMIN_ENDPOINTS.LINK_USER_JELLYFIN(userId),
        {
          method: "PATCH",
          body: { jellyfin_user_id: jellyfinUserId },
        },
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.admin.users(),
      });
    },
  });
}
