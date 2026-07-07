import { useQuery } from "@tanstack/react-query";
import { useFetcher } from "@/lib/api/context";
import { queryKeys } from "@/lib/queryKeys";
import { ADMIN_ENDPOINTS } from "@/lib/endpoints";
import type { ListUsersResponse } from "@rawkoon/shared/types";

export function useAdminUsers() {
  const fetcher = useFetcher();

  return useQuery({
    queryKey: queryKeys.admin.users(),
    queryFn: () => fetcher<ListUsersResponse>(ADMIN_ENDPOINTS.USERS),
  });
}
