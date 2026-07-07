import { useCallback } from "react";
import { getQueryClient } from "@/lib/api/queryClient";
import { prefetchRouteDataOptimistic } from "@/lib/routing/prefetch";

/**
 * Hook to prefetch route data on link hover for instant navigation
 * This eliminates loading states when navigating between pages
 */
export function usePrefetchRoute() {
  const prefetch = useCallback(
    (route: string, params: Record<string, unknown> = {}) => {
      const queryClient = getQueryClient();
      if (!queryClient) return;

      // Use optimistic (non-blocking) prefetch for hover/touch
      prefetchRouteDataOptimistic(queryClient, route, params);
    },
    [],
  );

  return prefetch;
}
