import { useQuery } from "@tanstack/react-query";
import { useFetcher } from "@/lib/api/context";
import { queryKeys } from "@/lib/queryKeys";
import { LIBRARY_ENDPOINTS } from "@/lib/endpoints";
import type { MediaPostProcessingSettingsResponse } from "@rawkoon/shared/types";

export function useMediaPostProcessingSettings() {
  const fetcher = useFetcher();

  return useQuery({
    queryKey: queryKeys.library.postProcessingSettings(),
    queryFn: () =>
      fetcher<MediaPostProcessingSettingsResponse>(
        LIBRARY_ENDPOINTS.POST_PROCESSING_SETTINGS,
      ),
  });
}
