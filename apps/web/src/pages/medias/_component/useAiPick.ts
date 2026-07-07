import { useQuery } from "@tanstack/react-query";
import { useFetcher } from "@/lib/api/context";
import { queryKeys } from "@/lib/queryKeys";
import { MEDIAS_ENDPOINTS } from "@/lib/endpoints";
import type { InteractiveReleaseItem } from "@rawkoon/shared/types";

interface AiPickResult {
  release_key: string;
  reasoning: string;
}

interface UseAiPickParams {
  enabled: boolean;
  releases: InteractiveReleaseItem[];
  mediaTitle: string;
  mediaYear: number | null;
  mediaType: "movie" | "tv";
}

export function useAiPick({
  enabled,
  releases,
  mediaTitle,
  mediaYear,
  mediaType,
}: UseAiPickParams) {
  const fetcher = useFetcher();

  const candidates = releases.filter((r) => !r.rejected);
  const releaseKeys = candidates.map((r) => r.guid).join(",");

  return useQuery({
    queryKey: queryKeys.medias.aiPick(
      mediaTitle,
      mediaYear,
      mediaType,
      releaseKeys,
    ),
    queryFn: () =>
      fetcher<AiPickResult>(MEDIAS_ENDPOINTS.INTERACTIVE_SEARCH_AI_PICK, {
        method: "POST",
        body: {
          media_context: {
            title: mediaTitle,
            year: mediaYear,
            type: mediaType,
          },
          releases: candidates.map((r) => ({
            key: r.guid,
            title: r.title,
            size_bytes: r.size_bytes ?? null,
            seeders: r.seeders ?? null,
            score: r.quality_score ?? null,
            rejected: r.rejected,
          })),
        },
      }),
    enabled: enabled && candidates.length > 0,
    retry: 0,
    staleTime: 5 * 60 * 1000,
  });
}
