import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useFetcher } from "@/lib/api/context";
import { queryKeys } from "@/lib/queryKeys";
import { DASHBOARD_ENDPOINTS } from "@/lib/endpoints";
import type { DashboardUpcomingResponse } from "@rawkoon/shared/types";
export function useDashboardUpcoming(options?: { enabled?: boolean }) {
  const fetcher = useFetcher();

  return useQuery({
    queryKey: queryKeys.dashboard.upcoming(),
    queryFn: () =>
      fetcher<DashboardUpcomingResponse>(DASHBOARD_ENDPOINTS.UPCOMING.LIST),
    enabled: options?.enabled ?? true,
  });
}

export function useAddUpcomingToLibrary() {
  const fetcher = useFetcher();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: { media_type: "movie" | "tv"; tmdb_id: number }) =>
      fetcher<{
        success: boolean;
        added: boolean;
        already_exists: boolean;
      }>(DASHBOARD_ENDPOINTS.UPCOMING.ADD, {
        method: "POST",
        body: data,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.dashboard.upcoming(),
      });
    },
  });
}
