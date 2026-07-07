import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useFetcher } from "@/lib/api/context";
import { queryKeys } from "@/lib/queryKeys";
import { LIBRARY_ENDPOINTS } from "@/lib/endpoints";
import type { LibraryMedia } from "@rawkoon/shared/types";

type OverridesPayload = {
  title?: string | null;
  sort_title?: string | null;
  year?: number | null;
  overview?: string | null;
  poster_url?: string | null;
};

export function useUpdateLibraryOverrides() {
  const fetcher = useFetcher();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      id,
      overrides,
    }: {
      id: number;
      overrides: OverridesPayload;
    }) =>
      fetcher<{ item: LibraryMedia }>(LIBRARY_ENDPOINTS.UPDATE_OVERRIDES(id), {
        method: "PATCH",
        body: overrides,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.library.all });
    },
  });
}
