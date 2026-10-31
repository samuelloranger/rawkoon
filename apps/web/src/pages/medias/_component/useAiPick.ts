import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useFetcher } from "@/lib/api/context";
import { queryKeys } from "@/lib/queryKeys";
import { MEDIAS_ENDPOINTS } from "@/lib/endpoints";
import type { InteractiveReleaseItem } from "@rawkoon/shared/types";

interface AiPickResult {
  release_key: string;
  reasoning: string;
}

/** The episode target only holds while the search is still scoped to its season. */
export function resolveAiTarget(
  episodeTarget: { season: number; episode: number } | null | undefined,
  selectedSeason: number | "complete" | null,
): { season: number | null; episode: number | null } {
  if (selectedSeason === "complete") return { season: null, episode: null };
  if (
    episodeTarget &&
    (selectedSeason === null || selectedSeason === episodeTarget.season)
  ) {
    return { season: episodeTarget.season, episode: episodeTarget.episode };
  }
  return { season: selectedSeason, episode: null };
}

interface UseAiPickParams {
  enabled: boolean;
  releases: InteractiveReleaseItem[];
  mediaTitle: string;
  mediaYear: number | null;
  mediaType: "movie" | "tv";
  /** Library id, when searching from a media page; links the call in AI history. */
  libraryMediaId?: number | null;
  /** Target of the search: an episode, or a season pack when episode is null. */
  season?: number | null;
  episode?: number | null;
}

export type AiPickInput = Omit<UseAiPickParams, "enabled">;

/** The identity of one AI pick: the request it makes, and what a dismissal applies to. */
export function aiPickQueryKey(input: AiPickInput) {
  const releaseKeys = input.releases
    .filter((r) => !r.rejected)
    .map((r) => r.guid)
    .join(",");
  return queryKeys.medias.aiPick(
    input.mediaTitle,
    input.mediaYear,
    input.mediaType,
    releaseKeys,
    input.libraryMediaId ?? null,
    input.season ?? null,
    input.episode ?? null,
  );
}

export function useAiPick(params: UseAiPickParams) {
  const {
    enabled,
    releases,
    mediaTitle,
    mediaYear,
    mediaType,
    libraryMediaId,
    season,
    episode,
  } = params;
  const fetcher = useFetcher();

  const candidates = releases.filter((r) => !r.rejected);

  return useQuery({
    queryKey: aiPickQueryKey(params),
    queryFn: () =>
      fetcher<AiPickResult>(MEDIAS_ENDPOINTS.INTERACTIVE_SEARCH_AI_PICK, {
        method: "POST",
        body: {
          ...(libraryMediaId != null ? { media_id: libraryMediaId } : {}),
          media_context: {
            title: mediaTitle,
            year: mediaYear,
            type: mediaType,
            ...(season != null ? { season, episode: episode ?? null } : {}),
          },
          releases: candidates.map((r) => ({
            key: r.guid,
            title: r.title,
            size_bytes: r.size_bytes ?? null,
            seeders: r.seeders ?? null,
            score: r.quality_score ?? null,
            indexer: r.indexer ?? null,
            rejected: r.rejected,
          })),
        },
      }),
    enabled: enabled && candidates.length > 0,
    retry: 0,
    staleTime: 5 * 60 * 1000,
  });
}

/** Dismissal of the AI suggestion, scoped to one pick (see aiPickQueryKey). */
export function useAiDismissal(pickKey: readonly unknown[]) {
  const scope = JSON.stringify(pickKey);
  const [dismissed, setDismissed] = useState(false);
  const [prevScope, setPrevScope] = useState(scope);
  // Render-time state adjustment, not an effect.
  if (scope !== prevScope) {
    setPrevScope(scope);
    setDismissed(false);
  }
  return { dismissed, dismiss: () => setDismissed(true) };
}
