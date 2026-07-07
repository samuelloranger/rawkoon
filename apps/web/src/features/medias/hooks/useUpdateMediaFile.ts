import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useFetcher } from "@/lib/api/context";
import { queryKeys } from "@/lib/queryKeys";
import { LIBRARY_ENDPOINTS } from "@/lib/endpoints";

export function useUpdateMediaFile() {
  const fetcher = useFetcher();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      fileId,
      release_group,
    }: {
      fileId: number;
      release_group: string | null;
    }) =>
      fetcher<{ id: number; release_group: string | null }>(
        LIBRARY_ENDPOINTS.UPDATE_FILE(fileId),
        { method: "PATCH", body: { release_group } },
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.library.all });
    },
  });
}
