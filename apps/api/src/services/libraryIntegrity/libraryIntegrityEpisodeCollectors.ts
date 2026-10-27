import type { LibraryHealthIssue } from "@rawkoon/shared";
import { prisma } from "@rawkoon/api/db";
import {
  getLibraryTmdbApiKey,
  tmdbApiFetch,
} from "@rawkoon/api/utils/medias/libraryHelpers";
import { TMDB_LANGUAGE_LIBRARY_PERSISTENCE } from "@rawkoon/api/utils/medias/tmdbFetcherTypes";

const TMDB_REQUEST_DELAY_MS = 250;
/** Shows processed per TMDB episode drift batch (limits memory vs loading all shows at once) */
const SHOW_TMDB_PAGE_SIZE = 25;

type TmdbEpisode = {
  id: number;
  episode_number: number;
  runtime?: number | null;
};

/**
 * How far a file's runtime may drift from the provider's before we call it a
 * mismatch. Generous on purpose: this is meant to catch a 44-minute file
 * sitting on a 90-minute double episode, not ordinary encoding differences.
 */
const EPISODE_RUNTIME_TOLERANCE_MINS = 15;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function collectEpisodeNumberMismatches(
  warnings: string[],
): Promise<LibraryHealthIssue[]> {
  const apiKey = await getLibraryTmdbApiKey();
  if (!apiKey) {
    warnings.push(
      "TMDB integration is disabled or missing an API key; episode mismatch checks were skipped.",
    );
    return [];
  }

  const issues: LibraryHealthIssue[] = [];
  let cursor: { id: number } | undefined;

  for (;;) {
    const shows = await prisma.libraryMedia.findMany({
      take: SHOW_TMDB_PAGE_SIZE,
      ...(cursor ? { cursor, skip: 1 } : {}),
      where: { type: "show" },
      select: {
        id: true,
        tmdbId: true,
        title: true,
        episodes: {
          select: {
            id: true,
            season: true,
            episode: true,
            tmdbEpisodeId: true,
            files: { select: { durationSecs: true } },
          },
          orderBy: [{ season: "asc" }, { episode: "asc" }],
        },
      },
      orderBy: { id: "asc" },
    });

    if (shows.length === 0) break;

    for (const show of shows) {
      try {
        const details = await tmdbApiFetch<{
          seasons: Array<{ season_number: number }>;
        }>(`tv/${show.tmdbId}`, apiKey, {
          language: TMDB_LANGUAGE_LIBRARY_PERSISTENCE,
        });

        const tmdbEpisodesById = new Map<
          number,
          { season: number; episode: number }
        >();
        const tmdbEpisodesByNumber = new Set<string>();
        const tmdbRuntimeById = new Map<number, number>();

        for (const season of details.seasons.filter(
          (s) => s.season_number > 0,
        )) {
          await sleep(TMDB_REQUEST_DELAY_MS);
          const seasonData = await tmdbApiFetch<{ episodes: TmdbEpisode[] }>(
            `tv/${show.tmdbId}/season/${season.season_number}`,
            apiKey,
            { language: TMDB_LANGUAGE_LIBRARY_PERSISTENCE },
          );

          for (const episode of seasonData.episodes) {
            tmdbEpisodesById.set(episode.id, {
              season: season.season_number,
              episode: episode.episode_number,
            });
            tmdbEpisodesByNumber.add(
              `${season.season_number}:${episode.episode_number}`,
            );
            if (typeof episode.runtime === "number" && episode.runtime > 0) {
              tmdbRuntimeById.set(episode.id, episode.runtime);
            }
          }
        }

        for (const episode of show.episodes) {
          const localKey = `${episode.season}:${episode.episode}`;
          const expected = episode.tmdbEpisodeId
            ? tmdbEpisodesById.get(episode.tmdbEpisodeId)
            : null;

          if (expected) {
            if (
              expected.season !== episode.season ||
              expected.episode !== episode.episode
            ) {
              issues.push({
                kind: "episode_number_mismatch",
                media_id: show.id,
                episode_id: episode.id,
                tmdb_id: show.tmdbId,
                tmdb_episode_id: episode.tmdbEpisodeId ?? undefined,
                title: show.title,
                media_type: "show",
                season: episode.season,
                episode: episode.episode,
                expected_season: expected.season,
                expected_episode: expected.episode,
                detail: `"${show.title}" S${episode.season}E${episode.episode} maps to TMDB S${expected.season}E${expected.episode}.`,
              });
            }
          } else if (
            episode.tmdbEpisodeId !== null &&
            !tmdbEpisodesByNumber.has(localKey)
          ) {
            issues.push({
              kind: "episode_number_mismatch",
              media_id: show.id,
              episode_id: episode.id,
              tmdb_id: show.tmdbId,
              tmdb_episode_id: episode.tmdbEpisodeId ?? undefined,
              title: show.title,
              media_type: "show",
              season: episode.season,
              episode: episode.episode,
              detail: `"${show.title}" S${episode.season}E${episode.episode} was not found in TMDB.`,
            });
          }

          // A file whose runtime is wildly off from the provider's is the
          // signature of a season imported against a different numbering
          // scheme — a 44-minute file sitting on a 90-minute double episode.
          // The shifted 44-vs-43-minute episodes around it will not trip
          // individually, but this anchor identifies the season.
          const providerRuntime = episode.tmdbEpisodeId
            ? tmdbRuntimeById.get(episode.tmdbEpisodeId)
            : undefined;
          const fileDuration = episode.files[0]?.durationSecs;

          if (providerRuntime != null && fileDuration != null) {
            const fileMinutes = fileDuration / 60;
            if (
              Math.abs(fileMinutes - providerRuntime) >
              EPISODE_RUNTIME_TOLERANCE_MINS
            ) {
              issues.push({
                kind: "episode_duration_mismatch",
                media_id: show.id,
                episode_id: episode.id,
                tmdb_id: show.tmdbId,
                tmdb_episode_id: episode.tmdbEpisodeId ?? undefined,
                title: show.title,
                media_type: "show",
                season: episode.season,
                episode: episode.episode,
                detail: `"${show.title}" S${episode.season}E${episode.episode} runs ${Math.round(fileMinutes)} min but TMDB says ${providerRuntime} min — the season may be numbered against a different scheme.`,
              });
            }
          }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        warnings.push(
          `Episode mismatch check failed for "${show.title}" (${show.id}): ${message}`,
        );
      }

      await sleep(TMDB_REQUEST_DELAY_MS);
    }

    cursor = { id: shows[shows.length - 1]!.id };
  }

  return issues;
}
