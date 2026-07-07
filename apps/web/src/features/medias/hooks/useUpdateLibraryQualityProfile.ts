import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useFetcher } from "@/lib/api/context";
import { queryKeys } from "@/lib/queryKeys";
import { LIBRARY_ENDPOINTS } from "@/lib/endpoints";
import type {
  UpdateLibraryQualityProfileRequest,
  LibraryMedia,
} from "@rawkoon/shared/types";

export function useUpdateLibraryQualityProfile() {
  const fetcher = useFetcher();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      id,
      body,
    }: {
      id: number;
      body: UpdateLibraryQualityProfileRequest;
    }) =>
      fetcher<{ item: LibraryMedia }>(
        LIBRARY_ENDPOINTS.UPDATE_QUALITY_PROFILE(id),
        { method: "PATCH", body },
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.library.all });
    },
  });
}
