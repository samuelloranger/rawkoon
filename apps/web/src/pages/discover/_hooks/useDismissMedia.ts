import { useMutation } from "@tanstack/react-query";
import { useFetcher } from "@/lib/api/context";
import { MEDIAS_ENDPOINTS } from "@/lib/endpoints";

export function useDismissMedia() {
  const fetcher = useFetcher();
  return useMutation({
    mutationFn: (vars: { tmdb_id: number; type: "movie" | "tv" }) =>
      fetcher<{ dismissed: boolean }>(MEDIAS_ENDPOINTS.DISCOVER_DISMISS, {
        method: "POST",
        body: vars,
      }),
  });
}
