import { useLibraryMutation } from "./useLibraryMutation";
import { LIBRARY_ENDPOINTS } from "@/lib/endpoints";
import type { LibraryMedia } from "@rawkoon/shared/types";

export type UpdateLibrarySearchTitleRequest = {
  search_title_language: string;
  search_title: string;
};

export function useUpdateLibrarySearchTitle() {
  return useLibraryMutation<
    { id: number; body: UpdateLibrarySearchTitleRequest },
    { item: LibraryMedia }
  >(({ id, body }) => [
    LIBRARY_ENDPOINTS.UPDATE_SEARCH_TITLE(id),
    { method: "PATCH", body },
  ]);
}
