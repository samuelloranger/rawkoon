import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useFetcher } from "@/lib/api/context";
import { queryKeys } from "@/lib/queryKeys";
import { LIBRARY_ENDPOINTS } from "@/lib/endpoints";
import type { LibraryMedia } from "@rawkoon/shared/types";

export type UpdateLibrarySearchTitleRequest = {
  search_title_language: string;
  search_title: string;
};

export function useUpdateLibrarySearchTitle() {
  const fetcher = useFetcher();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      id,
      body,
    }: {
      id: number;
      body: UpdateLibrarySearchTitleRequest;
    }) =>
      fetcher<{ item: LibraryMedia }>(
        LIBRARY_ENDPOINTS.UPDATE_SEARCH_TITLE(id),
        { method: "PATCH", body },
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.library.all });
    },
  });
}
