import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useFetcher } from "@/lib/api/context";
import { queryKeys } from "@/lib/queryKeys";
import { INTEGRATION_ENDPOINTS } from "@/lib/endpoints";
import type { QbittorrentIntegrationUpdateResponse } from "@rawkoon/shared/types";

export function useUpdateQbittorrentIntegration() {
  const fetcher = useFetcher();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: {
      website_url: string;
      username: string;
      password?: string;
      enabled: boolean;
    }) =>
      fetcher<QbittorrentIntegrationUpdateResponse>(
        INTEGRATION_ENDPOINTS.QBITTORRENT,
        {
          method: "PUT",
          body: data,
        },
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.integrations.qbittorrent(),
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.downloads.speed(),
      });
    },
  });
}
