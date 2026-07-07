import { useQuery } from "@tanstack/react-query";
import { useFetcher } from "@/lib/api/context";
import { queryKeys } from "@/lib/queryKeys";
import { ADMIN_ENDPOINTS } from "@/lib/endpoints";
import type { ScheduledJobsResponse } from "@rawkoon/shared/types";

export function useScheduledJobs() {
  const fetcher = useFetcher();

  return useQuery({
    queryKey: queryKeys.admin.scheduledJobs(),
    queryFn: () =>
      fetcher<ScheduledJobsResponse>(ADMIN_ENDPOINTS.SCHEDULED_JOBS),
    refetchInterval: 5000,
    refetchOnWindowFocus: true,
    refetchOnMount: true,
    refetchOnReconnect: true,
    refetchIntervalInBackground: true,
  });
}
