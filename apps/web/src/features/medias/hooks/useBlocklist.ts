import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useFetcher } from "@/lib/api/context";
import { queryKeys } from "@/lib/queryKeys";
import { MEDIAS_ENDPOINTS } from "@/lib/endpoints";
import type {
  AddBlocklistEntryPayload,
  BlocklistEntry,
  BlocklistListResponse,
} from "@rawkoon/shared/types";

export function useBlocklist(options?: {
  staleTime?: number;
  gcTime?: number;
}) {
  const fetcher = useFetcher();
  return useQuery({
    queryKey: queryKeys.blocklist.list(),
    queryFn: () => fetcher<BlocklistListResponse>(MEDIAS_ENDPOINTS.BLOCKLIST),
    ...options,
  });
}

export function useAddToBlocklist() {
  const fetcher = useFetcher();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: AddBlocklistEntryPayload) =>
      fetcher<{ entry: BlocklistEntry }>(MEDIAS_ENDPOINTS.BLOCKLIST, {
        method: "POST",
        body,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.blocklist.all });
    },
  });
}

export function useRemoveFromBlocklist() {
  const fetcher = useFetcher();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) =>
      fetcher<{ success: boolean }>(MEDIAS_ENDPOINTS.BLOCKLIST_ENTRY(id), {
        method: "DELETE",
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.blocklist.all });
    },
  });
}
