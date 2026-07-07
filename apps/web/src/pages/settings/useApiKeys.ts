import { useQuery } from "@tanstack/react-query";
import { useFetcher } from "@/lib/api/context";
import { queryKeys } from "@/lib/queryKeys";
import { ADMIN_ENDPOINTS } from "@/lib/endpoints";
import type { ApiKeysResponse } from "@rawkoon/shared/types";

export function useApiKeys() {
  const fetcher = useFetcher();

  return useQuery({
    queryKey: queryKeys.admin.apiKeys(),
    queryFn: () => fetcher<ApiKeysResponse>(ADMIN_ENDPOINTS.API_KEYS),
  });
}
