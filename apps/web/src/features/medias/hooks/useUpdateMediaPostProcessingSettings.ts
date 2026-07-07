import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useFetcher } from "@/lib/api/context";
import { queryKeys } from "@/lib/queryKeys";
import { LIBRARY_ENDPOINTS } from "@/lib/endpoints";
import type {
  MediaPostProcessingSettingsResponse,
  UpdateMediaPostProcessingSettingsRequest,
} from "@rawkoon/shared/types";

export function useUpdateMediaPostProcessingSettings() {
  const fetcher = useFetcher();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: UpdateMediaPostProcessingSettingsRequest) =>
      fetcher<MediaPostProcessingSettingsResponse>(
        LIBRARY_ENDPOINTS.POST_PROCESSING_SETTINGS,
        { method: "PATCH", body },
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.library.postProcessingSettings(),
      });
    },
  });
}
