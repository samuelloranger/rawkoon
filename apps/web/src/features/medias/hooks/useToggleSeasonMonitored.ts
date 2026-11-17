import { useLibraryMutation } from "./useLibraryMutation";
import { LIBRARY_ENDPOINTS } from "@/lib/endpoints";

export function useToggleSeasonMonitored() {
  return useLibraryMutation<
    { mediaId: number; season: number; monitored: boolean },
    { updated: number }
  >(({ mediaId, season, monitored }) => [
    LIBRARY_ENDPOINTS.UPDATE_SEASON_MONITORED(mediaId, season),
    { method: "PATCH", body: { monitored } },
  ]);
}
