import { prisma } from "@rawkoon/api/db";
import { checkAudioLanguages } from "@rawkoon/api/utils/medias/audioLanguageCheck";
import type { LibraryAudioTrack } from "@rawkoon/shared";

const KINDS = ["audio_language_mismatch", "audio_language_warn"];

/**
 * After an import, compare the file's audio with the profile's preferred
 * languages and raise (or clear) the matching attention alert. Alert only:
 * never touches the file or the release blocklist.
 */
export async function syncAudioLanguageAlert(opts: {
  mediaId: number;
  episodeId: number | null;
  /** Null when media info was unavailable: the scope is then unjudged. */
  tracks: readonly LibraryAudioTrack[] | null;
}): Promise<void> {
  if (opts.episodeId != null) {
    const episode = await prisma.libraryEpisode.findUnique({
      where: { id: opts.episodeId },
      select: { season: true },
    });
    // An open season alert owns this episode: recompute it rather than add a second alert.
    const seasonAlert =
      episode &&
      (await prisma.libraryAttentionAlert.findFirst({
        where: {
          mediaId: opts.mediaId,
          scopeType: "season_pack",
          season: episode.season,
          status: "open",
          kind: { in: KINDS },
        },
        select: { id: true },
      }));
    if (episode && seasonAlert) {
      await syncSeasonAudioLanguageAlert({
        mediaId: opts.mediaId,
        season: episode.season,
      });
      return;
    }
  }
  const scope = {
    mediaId: opts.mediaId,
    episodeId: opts.episodeId,
    scopeType: opts.episodeId == null ? "movie" : "episode",
  };
  const open = { ...scope, status: "open", kind: { in: KINDS } };
  const resolveOpen = () =>
    prisma.libraryAttentionAlert.updateMany({
      where: open,
      data: { status: "resolved_auto", resolvedAt: new Date() },
    });
  if (!opts.tracks) {
    await resolveOpen();
    return;
  }

  const media = await prisma.libraryMedia.findUnique({
    where: { id: opts.mediaId },
    select: {
      title: true,
      qualityProfile: { select: { preferredLanguages: true } },
    },
  });
  const preferred = media?.qualityProfile?.preferredLanguages ?? [];
  const result = checkAudioLanguages(opts.tracks, preferred);

  if (!("fileLanguages" in result)) {
    await resolveOpen();
    return;
  }

  const kind = kindOf(result.status);
  const detail =
    `"${media!.title}": file audio is ${result.fileLanguages.join(", ")}; ` +
    `profile prefers ${preferred.join(", ")}.`;
  await upsertAlert(scope, kind, detail);
}

const kindOf = (status: "mismatch" | "warn") =>
  status === "mismatch" ? "audio_language_mismatch" : "audio_language_warn";

type Scope = {
  mediaId: number;
  episodeId: number | null;
  scopeType: string;
  season?: number;
};

async function upsertAlert(scope: Scope, kind: string, detail: string) {
  const open = { ...scope, status: "open", kind: { in: KINDS } };
  const data = { detail, kind, libraryStatusSnapshot: "downloaded" };
  const existing = await prisma.libraryAttentionAlert.findFirst({
    where: open,
    select: { id: true },
  });
  if (existing) {
    await prisma.libraryAttentionAlert.update({
      where: { id: existing.id },
      data,
    });
  } else {
    // A re-import must not resurrect a dismissed alert; a season's detail carries
    // counts that change, so only its kind identifies it.
    const dismissed = await prisma.libraryAttentionAlert.findFirst({
      where: {
        ...scope,
        kind,
        ...(scope.scopeType === "season_pack" ? {} : { detail }),
        status: "dismissed",
      },
      select: { id: true },
    });
    if (dismissed) return;
    await prisma.libraryAttentionAlert.create({
      data: { ...scope, ...data, status: "open" },
    });
  }
}

/**
 * After a season-pack import (or an episode change inside an alerted season), judge every file the season holds and
 * keep ONE season alert instead of one per episode. Recomputed from stored
 * tracks, so the result does not depend on the order the pack's files land.
 */
export async function syncSeasonAudioLanguageAlert(opts: {
  mediaId: number;
  season: number;
}): Promise<void> {
  const episode = { season: opts.season };
  const scope = {
    mediaId: opts.mediaId,
    episodeId: null,
    scopeType: "season_pack",
    season: episode.season,
  };

  const [media, files] = await Promise.all([
    prisma.libraryMedia.findUnique({
      where: { id: opts.mediaId },
      select: {
        title: true,
        qualityProfile: { select: { preferredLanguages: true } },
      },
    }),
    prisma.mediaFile.findMany({
      where: { mediaId: opts.mediaId, episode: { season: episode.season } },
      select: { episodeId: true, audioTracks: true },
    }),
  ]);
  const preferred = media?.qualityProfile?.preferredLanguages ?? [];

  // The pack supersedes any per-episode alert for the episodes it re-judges.
  const episodeIds = files.flatMap((f) =>
    f.episodeId == null ? [] : [f.episodeId],
  );
  await prisma.libraryAttentionAlert.updateMany({
    where: {
      mediaId: opts.mediaId,
      scopeType: "episode",
      episodeId: { in: episodeIds },
      status: "open",
      kind: { in: KINDS },
    },
    data: { status: "resolved_auto", resolvedAt: new Date() },
  });

  const flagged: { status: "mismatch" | "warn"; languages: string[] }[] = [];
  let judged = 0;
  for (const f of files) {
    const tracks = f.audioTracks as unknown as LibraryAudioTrack[];
    if (!Array.isArray(tracks) || tracks.length === 0) continue;
    judged++;
    const r = checkAudioLanguages(tracks, preferred);
    if ("fileLanguages" in r) {
      flagged.push({ status: r.status, languages: r.fileLanguages });
    }
  }

  if (flagged.length === 0) {
    await prisma.libraryAttentionAlert.updateMany({
      where: { ...scope, status: "open", kind: { in: KINDS } },
      data: { status: "resolved_auto", resolvedAt: new Date() },
    });
    return;
  }

  const kind = kindOf(
    flagged.some((f) => f.status === "mismatch") ? "mismatch" : "warn",
  );
  const languages = [...new Set(flagged.flatMap((f) => f.languages))];
  const detail =
    `"${media!.title}" season ${episode.season}: ${flagged.length} of ${judged} episodes ` +
    `have audio that is ${languages.join(", ")}; profile prefers ${preferred.join(", ")}.`;
  await upsertAlert(scope, kind, detail);
}
