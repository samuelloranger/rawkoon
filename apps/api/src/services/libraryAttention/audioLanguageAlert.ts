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
  tracks: readonly LibraryAudioTrack[];
}): Promise<void> {
  const media = await prisma.libraryMedia.findUnique({
    where: { id: opts.mediaId },
    select: {
      title: true,
      qualityProfile: { select: { preferredLanguages: true } },
    },
  });
  const preferred = media?.qualityProfile?.preferredLanguages ?? [];
  const result = checkAudioLanguages(opts.tracks, preferred);

  const scope = {
    mediaId: opts.mediaId,
    episodeId: opts.episodeId,
    scopeType: opts.episodeId == null ? "movie" : "episode",
  };
  const open = { ...scope, status: "open", kind: { in: KINDS } };

  if (!("fileLanguages" in result)) {
    await prisma.libraryAttentionAlert.updateMany({
      where: open,
      data: { status: "resolved_auto", resolvedAt: new Date() },
    });
    return;
  }

  const kind =
    result.status === "mismatch"
      ? "audio_language_mismatch"
      : "audio_language_warn";
  const detail =
    `"${media!.title}": file audio is ${result.fileLanguages.join(", ")}; ` +
    `profile prefers ${preferred.join(", ")}.`;
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
    await prisma.libraryAttentionAlert.create({
      data: { ...scope, ...data, status: "open" },
    });
  }
}
