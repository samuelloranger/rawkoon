import type { DefaultOptions, QueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/queryKeys";

/**
 * Query defaults, kept here rather than inline in main.tsx so they can be
 * asserted in a test.
 *
 * `refetchOnMount: true` is load-bearing and easy to get wrong. A mutation on a
 * detail page invalidates the list, but `invalidateQueries` only refetches
 * queries that are currently mounted — the list is not, so it is merely marked
 * stale. It refetches when it mounts again on the way back, and ONLY if this is
 * true. With `false` the list stays stale indefinitely and shows deleted items
 * until the user presses refresh.
 *
 * `staleTime` is what keeps that from being expensive: data younger than 30s is
 * still considered fresh, so ordinary back-and-forth navigation does not refetch
 * and does not flash.
 */
export const QUERY_DEFAULTS: DefaultOptions = {
  queries: {
    refetchOnWindowFocus: false,
    // Refetch on mount only when the data is stale. See the note above.
    refetchOnMount: true,
    refetchOnReconnect: false,
    retry: 1,
    // Fresh for 30s, so navigating back and forth does not refetch or flash.
    staleTime: 30 * 1000,
    // Keep unused data for 5 minutes, so back navigation renders instantly.
    gcTime: 5 * 60 * 1000,
  },
};

let queryClientInstance: QueryClient | null = null;

export function setQueryClient(client: QueryClient): void {
  queryClientInstance = client;
}

export function getQueryClient(): QueryClient | null {
  return queryClientInstance;
}

export function invalidateAuthCache(): void {
  if (queryClientInstance) {
    queryClientInstance.invalidateQueries({ queryKey: queryKeys.auth.all });
    queryClientInstance.setQueryData(queryKeys.auth.me, null);
  }
}
