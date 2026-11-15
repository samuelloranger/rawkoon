import { queryOptions, useQuery } from "@tanstack/react-query";
import { useFetcher, type Fetcher } from "@/lib/api/context";
import { queryKeys } from "@/lib/queryKeys";
import { LIBRARY_ENDPOINTS } from "@/lib/endpoints";
import type { MediaPostProcessingSettingsResponse } from "@rawkoon/shared/types";

/** Shared with the add flow, which reads the defaults before opening the dialog. */
export function mediaPostProcessingSettingsQuery(fetcher: Fetcher) {
  return queryOptions({
    queryKey: queryKeys.library.postProcessingSettings(),
    queryFn: () =>
      fetcher<MediaPostProcessingSettingsResponse>(
        LIBRARY_ENDPOINTS.POST_PROCESSING_SETTINGS,
      ),
  });
}

export function useMediaPostProcessingSettings(options?: {
  enabled?: boolean;
}) {
  const fetcher = useFetcher();

  return useQuery({
    ...mediaPostProcessingSettingsQuery(fetcher),
    enabled: options?.enabled ?? true,
  });
}
