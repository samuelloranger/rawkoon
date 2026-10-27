import { prisma } from "@rawkoon/api/db";
import {
  LIBRARY_FAST_GRAB_ATTEMPTS,
  LIBRARY_SLOW_GRAB_INTERVAL_MS,
  MAX_LIBRARY_GRAB_ATTEMPTS,
} from "@rawkoon/api/constants/libraryGrab";
import { notifyAdminsLibraryGrabSkipped } from "@rawkoon/api/workers/notifyLibraryGrabSkipped";

const capReason = (reason: string) =>
  `No matching release after ${MAX_LIBRARY_GRAB_ATTEMPTS} attempts (${reason})`;

/** Whether the release sweep should search an item now: every sweep at first, then once a day. */
export function isGrabSearchDue(
  item: { searchAttempts: number; lastMissAt: Date | null },
  now: Date = new Date(),
): boolean {
  if (item.searchAttempts < LIBRARY_FAST_GRAB_ATTEMPTS || !item.lastMissAt) {
    return true;
  }
  return (
    now.getTime() - item.lastMissAt.getTime() >= LIBRARY_SLOW_GRAB_INTERVAL_MS
  );
}

/** Count a failed automatic grab against a movie; skip and notify at the cap. */
export async function recordMovieMiss(
  m: { id: number; searchAttempts: number },
  reason: string,
): Promise<void> {
  const next = m.searchAttempts + 1;
  const reachedCap = next >= MAX_LIBRARY_GRAB_ATTEMPTS;
  await prisma.libraryMedia.update({
    where: { id: m.id },
    data: {
      searchAttempts: next,
      lastMissAt: new Date(),
      ...(reachedCap ? { status: "skipped" } : {}),
    },
  });
  if (reachedCap) {
    await notifyAdminsLibraryGrabSkipped({
      mediaId: m.id,
      reason: capReason(reason),
      scope: "movie",
    });
  }
}

/** Count a failed automatic grab against an episode; skip and notify at the cap. */
export async function recordEpisodeMiss(
  ep: { id: number; mediaId: number; searchAttempts: number },
  reason: string,
): Promise<void> {
  const next = ep.searchAttempts + 1;
  const reachedCap = next >= MAX_LIBRARY_GRAB_ATTEMPTS;
  await prisma.libraryEpisode.update({
    where: { id: ep.id },
    data: {
      searchAttempts: next,
      lastMissAt: new Date(),
      ...(reachedCap ? { status: "skipped" } : {}),
    },
  });
  if (reachedCap) {
    await notifyAdminsLibraryGrabSkipped({
      mediaId: ep.mediaId,
      episodeId: ep.id,
      reason: capReason(reason),
      scope: "episode",
    });
  }
}

/** Count a failed season-pack grab against every episode in it; notify once if any hit the cap. */
export async function recordSeasonPackMiss(
  mediaId: number,
  season: number,
  episodes: { id: number; searchAttempts: number }[],
  reason: string,
): Promise<void> {
  let anySkipped = false;
  for (const ep of episodes) {
    const next = ep.searchAttempts + 1;
    const reachedCap = next >= MAX_LIBRARY_GRAB_ATTEMPTS;
    await prisma.libraryEpisode.update({
      where: { id: ep.id },
      data: {
        searchAttempts: next,
        lastMissAt: new Date(),
        ...(reachedCap ? { status: "skipped" } : {}),
      },
    });
    if (reachedCap) anySkipped = true;
  }
  if (anySkipped) {
    await notifyAdminsLibraryGrabSkipped({
      mediaId,
      season,
      reason: capReason(reason),
      scope: "season_pack",
    });
  }
}
