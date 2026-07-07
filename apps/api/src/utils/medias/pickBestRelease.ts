import type { NormalizedRelease } from "@rawkoon/api/services/indexerManager/types";
import { parseReleaseTitle } from "@rawkoon/api/utils/medias/filenameParser";
import {
  scoreRelease,
  type QualityProfileScoreInput,
} from "@rawkoon/api/utils/medias/releaseScorer";

export type ScoredRelease = {
  release: NormalizedRelease;
  downloadUrl: string;
  score: number;
};

export function scoreReleasesForProfile(
  candidates: NormalizedRelease[],
  profile: QualityProfileScoreInput | null,
): ScoredRelease[] {
  const scored: ScoredRelease[] = [];

  for (const release of candidates) {
    const downloadUrl = release.magnetUrl ?? release.downloadUrl;
    if (!downloadUrl) continue;

    if (profile) {
      const parsed = parseReleaseTitle(release.title);
      const result = scoreRelease(
        parsed,
        profile,
        release.sizeBytes,
        release.title,
        release.indexer,
        release.freeleech,
        release.seeders ?? null,
      );
      if (Array.isArray(result)) continue;
      scored.push({ release, downloadUrl, score: result });
    } else {
      scored.push({ release, downloadUrl, score: 0 });
    }
  }

  return scored;
}

export function pickBestScored(scored: ScoredRelease[]): ScoredRelease | null {
  if (!scored.length) return null;
  return [...scored].sort((a, b) => b.score - a.score)[0]!;
}
