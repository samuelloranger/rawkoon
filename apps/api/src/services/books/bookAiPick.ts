import { prisma } from "@rawkoon/api/db";
import {
  loadEnabledAiProviderConfig,
  pickBookReleaseWithAi,
} from "@rawkoon/api/services/aiProvider/client";
import type { EditionContext } from "@rawkoon/api/services/books/bookGrabber";
import type { AiTrigger } from "@rawkoon/shared/types";

export type BookPickCandidate = {
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
 * filters. `candidates` must be sorted best-first; with no AI, fewer than two
 * grabbable candidates, or any failure, the best non-blocklisted one is returned.
 */
export async function pickBookCandidate<T>(
  edition: EditionContext,
  candidates: T[],
  trigger: AiTrigger,
  describe: (item: T) => BookPickCandidate,
): Promise<{ pick: T; aiPicked: boolean }> {
  if (candidates.length < 2) {
    return { pick: candidates[0] as T, aiPicked: false };
  }

  const all = candidates.map(describe);
  // grabBookRelease refuses a blocklisted title without trying another, so
  // both the classic choice and the judge skip blocklisted releases up front.
  const blocked = await blocklistedTitles(all.map((c) => c.title));
  const allowed = all.flatMap((c, i) => (blocked.has(c.title) ? [] : [i]));
  const classicIndex = allowed[0] ?? 0;
  const classic = { pick: candidates[classicIndex] as T, aiPicked: false };
  if (allowed.length < 2) return classic;

  try {
    const config = await loadEnabledAiProviderConfig();
    if (!config) return classic;

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
      // Index keys: two results can share a download URL under different titles.
      allowed.map((i) => {
        const c = all[i]!;
        return {
          key: String(i),
          title: c.title,
          size_bytes: c.sizeBytes,
          seeders: c.seeders,
          score: c.score,
          format: c.format,
          kind: c.kind,
          language: c.language,
          audio_bitrate: c.audioBitrate,
        };
      }),
      {
        feature: "book_release_pick",
        trigger,
        classicTitle: all[classicIndex]?.title,
        bookEditionId: edition.editionId,
      },
    );
    if (!result) return classic;

    const index = Number(result.release_key);
    if (!allowed.includes(index)) return classic;
    return { pick: candidates[index] as T, aiPicked: true };
  } catch (e) {
    console.warn("[bookAiPick] AI pick failed, using classic:", e);
    return classic;
  }
}

async function blocklistedTitles(titles: string[]): Promise<Set<string>> {
  try {
    const rows = await prisma.grabBlocklist.findMany({
      where: { releaseTitle: { in: titles } },
      select: { releaseTitle: true },
    });
    return new Set(rows.map((r) => r.releaseTitle));
  } catch (e) {
    // grabBookRelease re-checks the title, so a failed lookup only risks a refused grab.
    console.warn("[bookAiPick] blocklist lookup failed:", e);
    return new Set();
  }
}
