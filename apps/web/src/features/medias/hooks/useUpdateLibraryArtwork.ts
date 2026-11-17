import { useLibraryMutation } from "./useLibraryMutation";
import { LIBRARY_ENDPOINTS } from "@/lib/endpoints";
import type { ArtworkKind, LibraryMedia } from "@rawkoon/shared/types";

const OVERRIDE_FIELD: Record<ArtworkKind, "poster_url" | "backdrop_url"> = {
  poster: "poster_url",
  backdrop: "backdrop_url",
};

/** Writes the picked artwork through the overrides PATCH; null clears it. */
export function useUpdateLibraryArtwork() {
  return useLibraryMutation<
    { id: number; kind: ArtworkKind; url: string | null },
    { item: LibraryMedia }
  >(({ id, kind, url }) => [
    LIBRARY_ENDPOINTS.UPDATE_OVERRIDES(id),
    { method: "PATCH", body: { [OVERRIDE_FIELD[kind]]: url } },
  ]);
}
