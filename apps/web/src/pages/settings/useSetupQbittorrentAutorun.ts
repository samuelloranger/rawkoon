import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useFetcher } from "@/lib/api/context";
import { queryKeys } from "@/lib/queryKeys";
import { INTEGRATION_ENDPOINTS } from "@/lib/endpoints";

type AutorunSetupResponse = {
  success: boolean;
  rawkoon_url: string;
};

export function useSetupQbittorrentAutorun() {
  const fetcher = useFetcher();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body?: { rawkoon_url?: string }) =>
      fetcher<AutorunSetupResponse>(
        `${INTEGRATION_ENDPOINTS.QBITTORRENT}/autorun-setup`,
        {
          method: "POST",
          body: body ?? {},
        },
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.integrations.qbittorrent(),
      });
    },
  });
}
