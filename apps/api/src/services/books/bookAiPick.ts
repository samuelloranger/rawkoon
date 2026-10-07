import { prisma } from "@rawkoon/api/db";
import {
  loadEnabledAiProviderConfig,
  pickBookReleaseWithAi,
} from "@rawkoon/api/services/aiProvider/client";
import type { EditionContext } from "@rawkoon/api/services/books/bookGrabber";
import type { AiTrigger } from "@rawkoon/shared/types";

export type BookPickCandidate = {
  /** The grab URL; used only as the lookup key, never shown to the model. */
  url: string;
  title: string;
  sizeBytes: number | null;
  seeders: number | null;
  score: number | null;
  format: string | null;
  kind: string | null;
  language: string | null;
  audioBitrate: number | null;
};

/**
 * Lets the AI judge choose among candidates already approved by the classic
 * filters. `candidates` must be sorted best-first; with no AI, a single
 * candidate, or any failure, the classic best (index 0) is returned.
 */
export async function pickBookCandidate<T>(
  edition: EditionContext,
  candidates: T[],
  trigger: AiTrigger,
  describe: (item: T) => BookPickCandidate,
): Promise<{ pick: T; aiPicked: boolean }> {
  const classic = { pick: candidates[0] as T, aiPicked: false };
  if (candidates.length < 2) return classic;

  try {
    const config = await loadEnabledAiProviderConfig();
    if (!config) return classic;

    // grabBookRelease refuses blocklisted titles without trying another, so the
    // judge only sees releases that can actually be grabbed.
    const all = candidates.map(describe);
    const blocked = await prisma.grabBlocklist
      .findMany({
        where: { releaseTitle: { in: all.map((c) => c.title) } },
        select: { releaseTitle: true },
      })
      .then((rows) => new Set(rows.map((r) => r.releaseTitle)));
    const described = all.filter((c) => !blocked.has(c.title));
    if (described.length < 2) return classic;

    const result = await pickBookReleaseWithAi(
      config,
      {
        title: edition.bookTitle,
        authors: edition.authors,
        kind: edition.kind,
        language: edition.bookLanguage,
        seriesName: edition.seriesName,
        seriesPosition: edition.seriesPosition,
      },
      described.map((c) => ({
        key: c.url,
        title: c.title,
        size_bytes: c.sizeBytes,
        seeders: c.seeders,
        score: c.score,
        format: c.format,
        kind: c.kind,
        language: c.language,
        audio_bitrate: c.audioBitrate,
      })),
      {
        feature: "book_release_pick",
        trigger,
        classicTitle: all[0]?.title,
        bookEditionId: edition.editionId,
      },
    );
    if (!result) return classic;

    const index = all.findIndex((c) => c.url === result.release_key);
    if (index === -1) return classic;
    return { pick: candidates[index] as T, aiPicked: true };
  } catch (e) {
    console.warn("[bookAiPick] AI pick failed, using classic:", e);
    return classic;
  }
}
