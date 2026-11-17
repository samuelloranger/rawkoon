import { useLibraryMutation } from "./useLibraryMutation";
import { LIBRARY_ENDPOINTS } from "@/lib/endpoints";
import type {
  UpdateLibraryQualityProfileRequest,
  LibraryMedia,
} from "@rawkoon/shared/types";

export function useUpdateLibraryQualityProfile() {
  return useLibraryMutation<
    { id: number; body: UpdateLibraryQualityProfileRequest },
    { item: LibraryMedia }
  >(({ id, body }) => [
    LIBRARY_ENDPOINTS.UPDATE_QUALITY_PROFILE(id),
    { method: "PATCH", body },
  ]);
}
