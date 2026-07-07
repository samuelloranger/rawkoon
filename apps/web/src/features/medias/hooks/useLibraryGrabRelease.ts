import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useFetcher } from "@/lib/api/context";
import { queryKeys } from "@/lib/queryKeys";
import { LIBRARY_ENDPOINTS } from "@/lib/endpoints";
import type { LibrarySearchResponse } from "@rawkoon/shared/types";

/** Interactive Prowlarr grab routed through Rawkoon (DownloadHistory + qB category). */
export function useLibraryGrabRelease(libraryMediaId: number | null) {
  const fetcher = useFetcher();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: {
      download_url: string;
      release_title: string;
      indexer?: string | null;
      quality_parsed?: unknown;
      size_bytes?: number | null;
      episode_id?: number | null;
      is_upgrade?: boolean;
    }) => {
      if (libraryMediaId == null || libraryMediaId <= 0) {
        throw new Error("Library context required");
      }
      return fetcher<LibrarySearchResponse>(
        LIBRARY_ENDPOINTS.GRAB(libraryMediaId),
        {
          method: "POST",
          body: {
            download_url: body.download_url,
            release_title: body.release_title,
            ...(body.indexer != null && body.indexer !== ""
              ? { indexer: body.indexer }
              : {}),
            ...(body.quality_parsed !== undefined
              ? { quality_parsed: body.quality_parsed }
              : {}),
            ...(body.size_bytes != null ? { size_bytes: body.size_bytes } : {}),
            ...(body.episode_id != null ? { episode_id: body.episode_id } : {}),
            ...(body.is_upgrade ? { is_upgrade: true } : {}),
          },
        },
      );
    },
    onSuccess: () => {
      const id = libraryMediaId;
      if (id == null || id <= 0) return;
      queryClient.invalidateQueries({ queryKey: queryKeys.library.all });
      queryClient.invalidateQueries({
        queryKey: queryKeys.library.downloads(id),
      });
    },
  });
}
