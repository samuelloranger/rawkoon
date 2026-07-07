import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useFetcher } from "@/lib/api/context";
import { queryKeys } from "@/lib/queryKeys";
import { LIBRARY_ENDPOINTS } from "@/lib/endpoints";

export function useRemoveFromLibrary() {
  const fetcher = useFetcher();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      id,
      deleteFiles,
    }: {
      id: number;
      deleteFiles?: boolean;
    }) => {
      const url = deleteFiles
        ? `${LIBRARY_ENDPOINTS.REMOVE(id)}?delete_files=true`
        : LIBRARY_ENDPOINTS.REMOVE(id);
      return fetcher<{ success: boolean }>(url, { method: "DELETE" });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.library.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.medias.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.all });
    },
  });
}
