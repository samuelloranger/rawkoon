import type {
  QueryClient,
  EnsureQueryDataOptions,
} from "@tanstack/react-query";
import { queryKeys } from "@/lib/queryKeys";
import {
  ADMIN_ENDPOINTS,
  DASHBOARD_ENDPOINTS,
  DOWNLOADS_ENDPOINTS,
  LIBRARY_ENDPOINTS,
  MEDIAS_ENDPOINTS,
  NOTIFICATION_ENDPOINTS,
  INTEGRATION_ENDPOINTS,
  QUALITY_PROFILES_ENDPOINTS,
} from "@/lib/endpoints";
import type { LibraryListResponse } from "@rawkoon/shared/types";
import { webFetcher } from "@/lib/api/fetcher";
import { fetchAuthMeUser } from "@/lib/auth/fetchAuthMeUser";
import { LIBRARY_PAGE_SIZE } from "@/features/medias/hooks/useInfiniteLibrary";

/**
 * The Library page reads an infinite query, so it can't go through the flat
 * ensureQueryData registry below — prefetch its first page explicitly.
 */
const libraryInfinitePrefetchArgs = {
  queryKey: queryKeys.library.infinite(undefined),
  queryFn: ({ pageParam }: { pageParam: number }) =>
    webFetcher<LibraryListResponse>(
      `${LIBRARY_ENDPOINTS.LIST}?page=${pageParam}&limit=${LIBRARY_PAGE_SIZE}`,
    ),
  initialPageParam: 1,
  getNextPageParam: (
    lastPage: LibraryListResponse,
    allPages: LibraryListResponse[],
  ) => (lastPage.has_more ? allPages.length + 1 : undefined),
};

/**
 * Eager cache fill for `/` (home): every TanStack Query used by the home UI.
 * Runs in the route loader before paint (SPA analogue of a server prefetch / “server action” bootstrap).
 */
async function prefetchHomePageData(queryClient: QueryClient): Promise<void> {
  const standard = [
    {
      queryKey: queryKeys.auth.me,
      queryFn: () => fetchAuthMeUser(webFetcher),
    },
    {
      queryKey: queryKeys.dashboard.upcoming(),
      queryFn: () => webFetcher(DASHBOARD_ENDPOINTS.UPCOMING.LIST),
    },
    {
      queryKey: queryKeys.downloads.speed(),
      queryFn: () => webFetcher(DOWNLOADS_ENDPOINTS.SPEED),
    },
  ];

  await Promise.allSettled([
    ...standard.map((q) =>
      queryClient.ensureQueryData(q as EnsureQueryDataOptions<unknown>),
    ),
    queryClient.prefetchQuery({
      queryKey: queryKeys.dashboard.jellyfinNowPlaying(),
      queryFn: () => webFetcher(DASHBOARD_ENDPOINTS.JELLYFIN.NOW_PLAYING),
    }),
  ]);
}

/** Non-blocking home prefetch (e.g. nav hover). */
function prefetchHomePageDataOptimistic(queryClient: QueryClient): void {
  void queryClient.prefetchQuery({
    queryKey: queryKeys.auth.me,
    queryFn: () => fetchAuthMeUser(webFetcher),
  });
  void queryClient.prefetchQuery({
    queryKey: queryKeys.dashboard.upcoming(),
    queryFn: () => webFetcher(DASHBOARD_ENDPOINTS.UPCOMING.LIST),
  });
  void queryClient.prefetchQuery({
    queryKey: queryKeys.downloads.speed(),
    queryFn: () => webFetcher(DOWNLOADS_ENDPOINTS.SPEED),
  });
  void queryClient.prefetchQuery({
    queryKey: queryKeys.dashboard.jellyfinNowPlaying(),
    queryFn: () => webFetcher(DASHBOARD_ENDPOINTS.JELLYFIN.NOW_PLAYING),
  });
}

/**
 * Query definitions for each route
 * Returns array of {queryKey, queryFn} objects
 */
const routeQueryDefinitions = {
  "/calendar": () => [
    {
      queryKey: queryKeys.dashboard.upcoming(),
      queryFn: () => webFetcher(DASHBOARD_ENDPOINTS.UPCOMING.LIST),
    },
  ],

  "/explore": () => [
    {
      queryKey: queryKeys.medias.explore(),
      queryFn: () => webFetcher(`${MEDIAS_ENDPOINTS.EXPLORE}?language=en`),
    },
  ],

  // "/library" is prefetched as an infinite query — see prefetchRouteData.

  "/notifications": () => [
    {
      queryKey: queryKeys.notifications.unreadCount(),
      queryFn: () => webFetcher(NOTIFICATION_ENDPOINTS.UNREAD_COUNT),
    },
    // Note: notifications list uses useInfiniteQuery which is harder to prefetch
    // with ensureQueryData due to structure mismatch if not careful.
  ],

  "/activity": (params: { service?: string; type?: string }) => [
    {
      queryKey: queryKeys.dashboard.activityFeed({
        limit: 25,
        service: params.service,
        type: params.type,
      }),
      queryFn: () => {
        const search = new URLSearchParams({ limit: "25" });
        if (params.service) search.set("service", params.service);
        if (params.type) search.set("type", params.type);
        return webFetcher(
          `${DASHBOARD_ENDPOINTS.ACTIVITIES_FEED}?${search.toString()}`,
        );
      },
    },
  ],

  "/settings": (params: { tab?: string }) => {
    const tab = params.tab || "profile";
    const queries: Array<{
      queryKey: readonly unknown[];
      queryFn: () => unknown;
    }> = [];

    // Always prefetch user profile for settings
    queries.push({
      queryKey: queryKeys.auth.me,
      queryFn: () => fetchAuthMeUser(webFetcher),
    });

    if (tab === "notifications") {
      queries.push({
        queryKey: queryKeys.notifications.devices(),
        queryFn: () => webFetcher(NOTIFICATION_ENDPOINTS.DEVICES),
      });
    }

    if (tab === "users") {
      queries.push({
        queryKey: queryKeys.admin.users(),
        queryFn: () => webFetcher(ADMIN_ENDPOINTS.USERS),
      });
    }

    if (tab === "integrations") {
      queries.push({
        queryKey: queryKeys.integrations.tmdb(),
        queryFn: () => webFetcher(INTEGRATION_ENDPOINTS.TMDB),
      });
      queries.push({
        queryKey: queryKeys.integrations.jellyfin(),
        queryFn: () => webFetcher(INTEGRATION_ENDPOINTS.JELLYFIN),
      });
      queries.push({
        queryKey: queryKeys.integrations.qbittorrent(),
        queryFn: () => webFetcher(INTEGRATION_ENDPOINTS.QBITTORRENT),
      });
    }

    if (tab === "jobs") {
      queries.push({
        queryKey: queryKeys.admin.scheduledJobs(),
        queryFn: () => webFetcher(ADMIN_ENDPOINTS.SCHEDULED_JOBS),
      });
    }

    if (tab === "media") {
      queries.push({
        queryKey: queryKeys.qualityProfiles.list(),
        queryFn: () => webFetcher(QUALITY_PROFILES_ENDPOINTS.LIST),
      });
    }

    return queries;
  },
} as const;

type RouteQueryDef = {
  queryKey: readonly unknown[];
  queryFn: () => unknown;
};
type RouteQueryMap = Record<
  string,
  ((params: Record<string, unknown>) => RouteQueryDef[]) | undefined
>;

/**
 * Generic helper to prefetch queries for a route using ensureQueryData
 */
async function prefetchQueriesForRoute(
  queryClient: QueryClient,
  routeId: string,
  params: Record<string, unknown> = {},
): Promise<void> {
  const queryDef = (routeQueryDefinitions as unknown as RouteQueryMap)[routeId];
  if (!queryDef) return;

  const queries = queryDef(params);
  await Promise.allSettled(
    queries.map((q) =>
      queryClient.ensureQueryData(q as EnsureQueryDataOptions<unknown>),
    ),
  );
}

/**
 * Prefetch data for a route
 * Used by router loaders - uses ensureQueryData (waits for data)
 */
export async function prefetchRouteData(
  queryClient: QueryClient,
  routeId: string,
  params: Record<string, unknown> = {},
): Promise<void> {
  const normalizedRouteId = routeId === "/dashboard" ? "/" : routeId;
  if (normalizedRouteId === "/") {
    await prefetchHomePageData(queryClient);
    return;
  }
  if (normalizedRouteId === "/library") {
    await queryClient.ensureInfiniteQueryData(libraryInfinitePrefetchArgs);
    return;
  }
  await prefetchQueriesForRoute(queryClient, routeId, params);
}

/**
 * Optimistically prefetch data for a route (fire and forget)
 * Used by hover prefetching - uses prefetchQuery (non-blocking)
 */
export function prefetchRouteDataOptimistic(
  queryClient: QueryClient,
  routeId: string,
  params: Record<string, unknown> = {},
): void {
  const normalizedRouteId = routeId === "/dashboard" ? "/" : routeId;
  if (normalizedRouteId === "/") {
    prefetchHomePageDataOptimistic(queryClient);
    return;
  }

  if (normalizedRouteId === "/library") {
    void queryClient.prefetchInfiniteQuery(libraryInfinitePrefetchArgs);
    return;
  }

  const queryDef = (routeQueryDefinitions as unknown as RouteQueryMap)[
    normalizedRouteId
  ];
  if (!queryDef) return;

  const queries = queryDef(params);
  queries.forEach((q) => {
    queryClient.prefetchQuery(q as EnsureQueryDataOptions<unknown>);
  });
}
