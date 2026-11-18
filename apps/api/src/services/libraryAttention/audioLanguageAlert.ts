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
    // A re-import of the same file must not resurrect an alert the user dismissed.
    const dismissed = await prisma.libraryAttentionAlert.findFirst({
      where: { ...scope, kind, detail, status: "dismissed" },
      select: { id: true },
    });
    if (dismissed) return;
    await prisma.libraryAttentionAlert.create({
      data: { ...scope, ...data, status: "open" },
    });
  }
}
