import type { SeasonMode } from "@rawkoon/shared/types";
import { useLibraryMutation } from "./useLibraryMutation";
import { LIBRARY_ENDPOINTS } from "@/lib/endpoints";

export function useSetMonitoredSeasons(mediaId: number) {
  return useLibraryMutation<
    {
      /** Absent = only the new-season flag changes. */
      season_mode?: SeasonMode;
      seasons?: number[];
      monitor_new_seasons: boolean;
    },
    { monitor_new_seasons: boolean }
  >((body) => [
    LIBRARY_ENDPOINTS.UPDATE_MONITORED_SEASONS(mediaId),
    { method: "PATCH", body },
  ]);
}
