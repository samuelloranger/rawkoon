import { useLibraryMutation } from "./useLibraryMutation";
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
  return useLibraryMutation<
    { id: number; overrides: OverridesPayload },
    { item: LibraryMedia }
  >(({ id, overrides }) => [
    LIBRARY_ENDPOINTS.UPDATE_OVERRIDES(id),
    { method: "PATCH", body: overrides },
  ]);
}
