import { useQuery } from "@tanstack/react-query";
import { useFetcher } from "@/lib/api/context";
import { queryKeys } from "@/lib/queryKeys";
import { DASHBOARD_ENDPOINTS } from "@/lib/endpoints";
import type { DashboardJellyfinNowPlayingResponse } from "@rawkoon/shared/types";

/**
 * Live Jellyfin playback sessions, polled every 15s. Backs the home
 * "Now watching" rail. Reports `enabled: false` when Jellyfin isn't
 * configured so the rail can hide itself.
 */
export function useNowWatching() {
  const fetcher = useFetcher();

  return useQuery({
    queryKey: queryKeys.dashboard.jellyfinNowPlaying(),
    queryFn: () =>
      fetcher<DashboardJellyfinNowPlayingResponse>(
        DASHBOARD_ENDPOINTS.JELLYFIN.NOW_PLAYING,
      ),
    refetchInterval: 15000,
  });
}
