import { useMutation, useQueryClient } from "@tanstack/react-query";
import type {
  DownloadClientIntegrationUpdateResponse,
  DownloadClientType,
} from "@rawkoon/shared/types";
import { useFetcher } from "@/lib/api/context";
import { INTEGRATION_ENDPOINTS } from "@/lib/endpoints";
import { queryKeys } from "@/lib/queryKeys";

export interface DownloadClientUpdate {
  client_type: DownloadClientType;
  website_url: string;
  username: string;
  password?: string;
  enabled: boolean;
  label: string;
  save_path?: string;
}

export function useUpdateDownloadClientIntegration() {
  const fetcher = useFetcher();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: DownloadClientUpdate) =>
      fetcher<DownloadClientIntegrationUpdateResponse>(
        INTEGRATION_ENDPOINTS.DOWNLOAD_CLIENT,
        { method: "PUT", body: data },
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.integrations.downloadClient(),
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.downloads.speed(),
      });
    },
  });
}
