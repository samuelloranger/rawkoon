import type { NormalizedRelease } from "@rawkoon/api/services/indexerManager/types";
import type { LocalAiConfig } from "@rawkoon/api/utils/integrations/types";
import {
  pickReleaseWithLocalAi,
  type LocalAiPickResult,
} from "@rawkoon/api/services/localAi/client";
import type { AiPickMediaContext } from "@rawkoon/api/utils/medias/buildAiPickPrompt";
import type { QualityProfileScoreInput } from "@rawkoon/api/utils/medias/releaseScorer";
import {
  pickBestScored,
  scoreReleasesForProfile,
  type ScoredRelease,
} from "@rawkoon/api/utils/medias/pickBestRelease";

export type GrabPickResult = ScoredRelease & {
  picked_by: "ai" | "classic";
  ai_reasoning?: string;
};

function toAiPickReleases(scored: ScoredRelease[]) {
  return scored.map(({ release, score }) => ({
    key: release.guid,
    title: release.title,
    size_bytes: release.sizeBytes,
    seeders: release.seeders,
    score,
  }));
}

function resolveAiPick(
  scored: ScoredRelease[],
  aiPick: LocalAiPickResult,
): GrabPickResult | null {
  const match = scored.find((s) => s.release.guid === aiPick.release_key);
  if (!match) return null;
  return {
    ...match,
    picked_by: "ai",
    ai_reasoning: aiPick.reasoning,
  };
}

export async function pickReleaseForGrab(opts: {
  candidates: NormalizedRelease[];
  profile: QualityProfileScoreInput | null;
  mediaContext: AiPickMediaContext;
  aiConfig: LocalAiConfig | null;
}): Promise<GrabPickResult | null> {
  const scored = scoreReleasesForProfile(opts.candidates, opts.profile);
  const classicBest = pickBestScored(scored);
  if (!classicBest) return null;

  if (!opts.aiConfig || scored.length < 2) {
    return { ...classicBest, picked_by: "classic" };
  }

  const aiPick = await pickReleaseWithLocalAi(
    opts.aiConfig,
    opts.mediaContext,
    toAiPickReleases(scored),
  );
  if (!aiPick) {
    return { ...classicBest, picked_by: "classic" };
  }

  return (
    resolveAiPick(scored, aiPick) ?? { ...classicBest, picked_by: "classic" }
  );
}
