import { useQuery } from "@tanstack/react-query";
import { useFetcher } from "@/lib/api/context";
import { queryKeys } from "@/lib/queryKeys";
import { DASHBOARD_ENDPOINTS } from "@/lib/endpoints";
import type { DashboardActivityFeedResponse } from "@rawkoon/shared/types";

export function useDashboardActivityFeed(
  params: { limit?: number; service?: string; type?: string } = {},
) {
  const fetcher = useFetcher();
  const search = new URLSearchParams();

  if (params.limit) search.set("limit", String(params.limit));
  if (params.service) search.set("service", params.service);
  if (params.type) search.set("type", params.type);

  const query = search.toString();
  const endpoint = query
    ? `${DASHBOARD_ENDPOINTS.ACTIVITIES_FEED}?${query}`
    : DASHBOARD_ENDPOINTS.ACTIVITIES_FEED;

  return useQuery({
    queryKey: queryKeys.dashboard.activityFeed(params),
    queryFn: () => fetcher<DashboardActivityFeedResponse>(endpoint),
  });
}
