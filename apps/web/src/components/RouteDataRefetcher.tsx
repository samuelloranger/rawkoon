import { useEffect, useRef } from "react";
import { useLocation } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/queryKeys";

/**
 * Component that refetches data when navigating between pages
 * This ensures data is fresh when users switch pages
 */
export function RouteDataRefetcher() {
  const location = useLocation();
  const queryClient = useQueryClient();
  const previousPathRef = useRef<string | null>(null);

  useEffect(() => {
    const currentPath = location.pathname;

    // Skip on initial mount
    if (previousPathRef.current === null) {
      previousPathRef.current = currentPath;
      return;
    }

    // Skip if path hasn't changed
    if (previousPathRef.current === currentPath) {
      return;
    }

    // Refetch data based on the current route
    const refetchRouteData = async () => {
      switch (currentPath) {
        case "/":
          // Dashboard - refetch stats and activities
          await queryClient.refetchQueries({
            queryKey: queryKeys.dashboard.all,
          });
          break;
        case "/notifications":
          // Notifications
          await queryClient.refetchQueries({
            queryKey: queryKeys.notifications.all,
          });
          break;
        default:
          // For other routes, don't refetch anything specific
          break;
      }
    };

    refetchRouteData();
    previousPathRef.current = currentPath;
  }, [location.pathname, queryClient]);

  return null;
}
