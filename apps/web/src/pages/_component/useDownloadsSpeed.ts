import { useQuery } from "@tanstack/react-query";
import { useFetcher } from "@/lib/api/context";
import { queryKeys } from "@/lib/queryKeys";
import { DOWNLOADS_ENDPOINTS } from "@/lib/endpoints/downloads";
import type { DownloadClientSpeed } from "@rawkoon/shared/types";

export function useDownloadsSpeed() {
  const fetcher = useFetcher();
  return useQuery<DownloadClientSpeed>({
    queryKey: queryKeys.downloads.speed(),
    queryFn: () => fetcher<DownloadClientSpeed>(DOWNLOADS_ENDPOINTS.SPEED),
    refetchInterval: 4_000,
  });
}
