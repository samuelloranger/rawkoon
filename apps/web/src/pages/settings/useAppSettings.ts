import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { SETTINGS_ENDPOINTS } from "@/lib/endpoints";
import { useFetcher } from "@/lib/api/context";
import { queryKeys } from "@/lib/queryKeys";
import type {
  AppSettingsResponse,
  UpdateAppSettingsRequest,
} from "@rawkoon/shared/types";

export function useAppSettings({ enabled = true }: { enabled?: boolean } = {}) {
  const fetcher = useFetcher();

  return useQuery({
    queryKey: queryKeys.settings.app(),
    queryFn: () => fetcher<AppSettingsResponse>(SETTINGS_ENDPOINTS.ROOT),
    enabled,
  });
}

export function useUpdateAppSettings() {
  const fetcher = useFetcher();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: UpdateAppSettingsRequest) =>
      fetcher<AppSettingsResponse>(SETTINGS_ENDPOINTS.ROOT, {
        method: "PATCH",
        body,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.settings.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.medias.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.library.all });
    },
  });
}
