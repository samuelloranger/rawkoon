import { useQuery } from "@tanstack/react-query";
import { useFetcher } from "@/lib/api/context";
import { queryKeys } from "@/lib/queryKeys";
import { ADMIN_ENDPOINTS } from "@/lib/endpoints";
import type { AdminSessionsResponse } from "@rawkoon/shared/types";

export function useAdminSessions() {
  const fetcher = useFetcher();

  return useQuery({
    queryKey: queryKeys.admin.sessions(),
    queryFn: () => fetcher<AdminSessionsResponse>(ADMIN_ENDPOINTS.SESSIONS),
  });
}
