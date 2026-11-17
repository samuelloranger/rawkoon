import { useLibraryMutation } from "./useLibraryMutation";
import { queryKeys } from "@/lib/queryKeys";
import { LIBRARY_ENDPOINTS } from "@/lib/endpoints";

export function useRemoveFromLibrary() {
  return useLibraryMutation<
    { id: number; deleteFiles?: boolean; releaseTorrents?: boolean },
    { success: boolean; released?: number }
  >(
    ({ id, deleteFiles, releaseTorrents }) => {
      const params = new URLSearchParams();
      if (deleteFiles) params.set("delete_files", "true");
      if (releaseTorrents) params.set("release_torrents", "true");
      const qs = params.toString();
      return [
        qs
          ? `${LIBRARY_ENDPOINTS.REMOVE(id)}?${qs}`
          : LIBRARY_ENDPOINTS.REMOVE(id),
        { method: "DELETE" },
      ];
    },
    {
      invalidate: () => [
        queryKeys.medias.all,
        queryKeys.dashboard.all,
        queryKeys.downloads.all,
      ],
    },
  );
}
