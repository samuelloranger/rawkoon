import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useFetcher } from "@/lib/api/context";
import { queryKeys } from "@/lib/queryKeys";
import { LIBRARY_ENDPOINTS } from "@/lib/endpoints";
import type { ArtworkKind, LibraryMedia } from "@rawkoon/shared/types";

const OVERRIDE_FIELD: Record<ArtworkKind, "poster_url" | "backdrop_url"> = {
  poster: "poster_url",
  backdrop: "backdrop_url",
};

/** Writes the picked artwork through the overrides PATCH; null clears it. */
export function useUpdateLibraryArtwork() {
  const fetcher = useFetcher();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      id,
      kind,
      url,
    }: {
      id: number;
      kind: ArtworkKind;
      url: string | null;
    }) =>
      fetcher<{ item: LibraryMedia }>(LIBRARY_ENDPOINTS.UPDATE_OVERRIDES(id), {
        method: "PATCH",
        body: { [OVERRIDE_FIELD[kind]]: url },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.library.all });
    },
  });
}
