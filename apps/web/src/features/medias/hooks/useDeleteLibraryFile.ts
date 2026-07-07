import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useFetcher } from "@/lib/api/context";
import { queryKeys } from "@/lib/queryKeys";
import { LIBRARY_ENDPOINTS } from "@/lib/endpoints";

export function useDeleteLibraryFile(libraryId: number) {
  const fetcher = useFetcher();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      fileId,
      deleteFile,
    }: {
      fileId: number;
      deleteFile: boolean;
    }) =>
      fetcher<{ success: boolean }>(
        `${LIBRARY_ENDPOINTS.DELETE_FILE(fileId)}${deleteFile ? "?delete_file=true" : ""}`,
        { method: "DELETE" },
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.library.files(libraryId),
      });
    },
  });
}
