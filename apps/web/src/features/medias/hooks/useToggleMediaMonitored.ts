import { useLibraryMutation } from "./useLibraryMutation";
import { LIBRARY_ENDPOINTS } from "@/lib/endpoints";
import type { LibraryMedia } from "@rawkoon/shared/types";

export function useToggleMediaMonitored() {
  return useLibraryMutation<
    { id: number; monitored: boolean },
    { item: LibraryMedia }
  >(({ id, monitored }) => [
    LIBRARY_ENDPOINTS.UPDATE_MONITORED(id),
    { method: "PATCH", body: { monitored } },
  ]);
}
