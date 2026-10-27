import { queryOptions, useQuery } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import { redirect } from "@tanstack/react-router";
import { fetchApi } from "@/lib/api/client";

interface FeatureFlags {
  books_enabled: boolean;
}

const featuresQuery = queryOptions({
  queryKey: ["system", "features"],
  queryFn: () => fetchApi<FeatureFlags>("/api/system/features"),
  staleTime: 5 * 60 * 1000,
});

/**
 * Feature flags readable by any signed-in user. Separate from /api/settings,
 * which is admin-only and therefore cannot gate navigation for everyone else.
 */
export function useFeatures() {
  return useQuery(featuresQuery);
}

/** Route guard: send everyone home when the books feature is switched off. */
export async function requireBooksEnabled(
  queryClient: QueryClient,
): Promise<void> {
  let flags: FeatureFlags;
  try {
    flags = await queryClient.fetchQuery(featuresQuery);
  } catch {
    // A failed flag fetch shouldn't lock people out of a feature that may be on.
    return;
  }
  if (!flags.books_enabled) throw redirect({ to: "/" });
}
