import { useQuery } from "@tanstack/react-query";
import { useFetcher } from "@/lib/api/context";
import { queryKeys } from "@/lib/queryKeys";
import { LIBRARY_ENDPOINTS } from "@/lib/endpoints";
import type {
  ArtworkCandidatesResponse,
  ArtworkKind,
} from "@rawkoon/shared/types";

/** Candidates are only fetched once the picker for that kind is open. */
export function useArtworkCandidates(
  id: number,
  kind: ArtworkKind,
  enabled: boolean,
) {
  const fetcher = useFetcher();
  return useQuery({
    queryKey: queryKeys.library.artwork(id, kind),
    queryFn: () =>
      fetcher<ArtworkCandidatesResponse>(LIBRARY_ENDPOINTS.IMAGES(id), {
        params: { kind },
      }),
    enabled,
    staleTime: 5 * 60 * 1000,
  });
}
