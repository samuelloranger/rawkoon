import { useQuery } from "@tanstack/react-query";
import { useFetcher } from "@/lib/api/context";
import { queryKeys } from "@/lib/queryKeys";
import { ADMIN_ENDPOINTS } from "@/lib/endpoints";
import type { AdminWebPushResponse } from "@rawkoon/shared/types";

export function useAdminWebPush() {
  const fetcher = useFetcher();

  return useQuery({
    queryKey: queryKeys.admin.webPush(),
    queryFn: () => fetcher<AdminWebPushResponse>(ADMIN_ENDPOINTS.WEB_PUSH),
  });
}
