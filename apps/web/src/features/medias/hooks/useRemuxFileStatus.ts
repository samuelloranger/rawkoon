import { useQuery } from "@tanstack/react-query";
import { useFetcher } from "@/lib/api/context";
import { queryKeys } from "@/lib/queryKeys";
import { LIBRARY_ENDPOINTS } from "@/lib/endpoints";
import type { RemuxFileStatus } from "./useRemuxFile";

export function useRemuxFileStatus(fileId: number, enabled = true) {
  const fetcher = useFetcher();
  return useQuery({
    queryKey: queryKeys.library.remuxFileStatus(fileId),
    queryFn: () =>
      fetcher<RemuxFileStatus>(LIBRARY_ENDPOINTS.FILE_REMUX_STATUS(fileId)),
    enabled,
    refetchInterval: (query) => {
      const state = query.state.data?.state;
      return state === "active" || state === "waiting" ? 2000 : false;
    },
  });
}
