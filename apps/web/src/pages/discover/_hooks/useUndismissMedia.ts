import { useMutation } from "@tanstack/react-query";
import { useFetcher } from "@/lib/api/context";
import { MEDIAS_ENDPOINTS } from "@/lib/endpoints";

export function useUndismissMedia() {
  const fetcher = useFetcher();
  return useMutation({
    mutationFn: (vars: { tmdb_id: number; type: "movie" | "tv" }) =>
      fetcher<{ success: boolean }>(
        MEDIAS_ENDPOINTS.DISCOVER_DISMISS_REMOVE(vars.tmdb_id, vars.type),
        { method: "DELETE" },
      ),
  });
}
