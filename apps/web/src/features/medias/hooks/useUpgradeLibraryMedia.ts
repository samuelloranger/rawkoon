import { useLibraryMutation } from "./useLibraryMutation";
import { LIBRARY_ENDPOINTS } from "@/lib/endpoints";

export function useUpgradeLibraryMedia() {
  return useLibraryMutation<
    { id: number; mode: "auto" | "manual" },
    { queued: boolean; mode: string; count?: number }
  >(({ id, mode }) => [
    LIBRARY_ENDPOINTS.UPGRADE(id),
    { method: "POST", body: { mode } },
  ]);
}
