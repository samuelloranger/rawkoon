import { useQuery } from "@tanstack/react-query";
import { useFetcher } from "@/lib/api/context";
import { queryKeys } from "@/lib/queryKeys";
import { ADMIN_ENDPOINTS } from "@/lib/endpoints";
import type { JobHistoryResponse } from "@rawkoon/shared/types";

export function useJobHistory(limit?: number) {
  const fetcher = useFetcher();

  return useQuery({
    queryKey: queryKeys.admin.jobHistory(),
    queryFn: () =>
      fetcher<JobHistoryResponse>(ADMIN_ENDPOINTS.JOB_HISTORY(limit)),
    refetchInterval: 10000,
  });
}
