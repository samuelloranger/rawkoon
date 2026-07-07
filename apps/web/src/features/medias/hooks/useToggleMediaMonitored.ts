import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useFetcher } from "@/lib/api/context";
import { queryKeys } from "@/lib/queryKeys";
import { LIBRARY_ENDPOINTS } from "@/lib/endpoints";
import type { LibraryMedia } from "@rawkoon/shared/types";

export function useToggleMediaMonitored() {
  const fetcher = useFetcher();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, monitored }: { id: number; monitored: boolean }) =>
      fetcher<{ item: LibraryMedia }>(LIBRARY_ENDPOINTS.UPDATE_MONITORED(id), {
        method: "PATCH",
        body: { monitored },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.library.all });
    },
  });
}
