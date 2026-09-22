import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  OrphansResponse,
  RemoveOrphansRequest,
  RemoveOrphansResponse,
} from "@rawkoon/shared/types";
import { useFetcher } from "@/lib/api/context";
import { DOWNLOADS_ENDPOINTS } from "@/lib/endpoints";
import { queryKeys } from "@/lib/queryKeys";

export function useOrphans(opts: { enabled?: boolean } = {}) {
  const fetcher = useFetcher();
  return useQuery({
    queryKey: queryKeys.downloads.orphans(),
    queryFn: () => fetcher<OrphansResponse>(DOWNLOADS_ENDPOINTS.ORPHANS),
    enabled: opts.enabled ?? true,
  });
}

export function useRemoveOrphans() {
  const fetcher = useFetcher();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: RemoveOrphansRequest) =>
      fetcher<RemoveOrphansResponse>(DOWNLOADS_ENDPOINTS.REMOVE_ORPHANS, {
        method: "POST",
        body,
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: queryKeys.downloads.orphans(),
      }),
  });
}
