import { useQuery } from "@tanstack/react-query";
import { fetchApi } from "@/lib/api/client";

export interface FeatureFlags {
  books_enabled: boolean;
}

/**
 * Feature flags readable by any signed-in user. Separate from /api/settings,
 * which is admin-only and therefore cannot gate navigation for everyone else.
 */
export function useFeatures() {
  return useQuery({
    queryKey: ["system", "features"],
    queryFn: () => fetchApi<FeatureFlags>("/api/system/features"),
    staleTime: 5 * 60 * 1000,
  });
}
