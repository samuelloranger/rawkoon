import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useFetcher } from "@/lib/api/context";
import { queryKeys } from "@/lib/queryKeys";
import { LIBRARY_ENDPOINTS } from "@/lib/endpoints";
import { useTitleLanguage } from "@/lib/useTitleLanguage";
import type { AddToLibraryResponse } from "@rawkoon/shared/types";

export function useAddToLibrary() {
  const fetcher = useFetcher();
  const queryClient = useQueryClient();
  const titleLanguage = useTitleLanguage();

  return useMutation({
    mutationFn: (body: { tmdb_id: number; type: "movie" | "show" }) =>
      fetcher<AddToLibraryResponse>(LIBRARY_ENDPOINTS.ADD, {
        method: "POST",
        body,
      }),
    onSuccess: (data) => {
      // Seed the per-item cache for an instant detail open.
      queryClient.setQueryData(
        queryKeys.library.item(data.item.id, titleLanguage),
        data,
      );
      queryClient.invalidateQueries({ queryKey: queryKeys.library.all });
    },
  });
}
