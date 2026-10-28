import { prisma } from "@rawkoon/api/db";

/** Episode statuses that mean the episode has its file; an upgrade keeps the old file. */
export const EPISODE_HAS_FILE_STATUSES = ["downloaded", "upgrading"] as const;

/**
 * True when every episode of the show that has already aired is downloaded.
 * This is the rule behind a show request becoming Available; it does not
 * depend on the show's TMDB airing state, so a complete show that is still
 * airing counts, and a partly downloaded ended show does not.
 *
 * Which episodes count:
 * - Aired means an air date on or before `now`. Episodes with no air date are
 *   left out: nothing says they are out yet.
 * - Specials (season 0) are left out: they are extras, and TMDB sync does not
 *   even import them.
 * - Unmonitored episodes are left out: the administrator told Rawkoon not to
 *   fetch them, so waiting on them would hold the request forever. A skipped
 *   episode stays monitored, so it still blocks until it is fetched.
 * - "Downloaded" means status downloaded or upgrading.
 *
 * At least one such episode is required, so a show with no aired episodes
 * (or none synced yet) is never complete.
 */
export async function allAiredEpisodesDownloaded(
  mediaId: number,
  now: Date = new Date(),
): Promise<boolean> {
  const aired = {
    mediaId,
    season: { gt: 0 },
    monitored: true,
    airDate: { lte: now },
  } as const;
  const [total, missing] = await Promise.all([
    prisma.libraryEpisode.count({ where: aired }),
    prisma.libraryEpisode.count({
      where: { ...aired, status: { notIn: [...EPISODE_HAS_FILE_STATUSES] } },
    }),
  ]);
  return total > 0 && missing === 0;
}
