import { prisma } from "@rawkoon/api/db";
import type { NormalizedRelease } from "@rawkoon/api/services/indexerManager/types";
import type { AiFeature, AiTrigger } from "@rawkoon/shared/types";
import type { AiProviderConfig } from "@rawkoon/api/utils/integrations/types";
import {
  pickReleaseWithAi,
  type AiPickResult,
} from "@rawkoon/api/services/aiProvider/client";
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
  aiPick: AiPickResult,
): GrabPickResult | null {
  const match = scored.find((s) => s.release.guid === aiPick.release_key);
  if (!match) return null;
  return {
    ...match,
    picked_by: "ai",
    ai_reasoning: aiPick.reasoning,
  };
}

/** Case-insensitive, like searchAndGrab; grabRelease re-checks by title and hash. */
async function blocklistedTitles(titles: string[]): Promise<Set<string>> {
  if (titles.length === 0) return new Set();
  try {
    const rows = await prisma.grabBlocklist.findMany({
      where: {
        OR: titles.map((title) => ({
          releaseTitle: { equals: title, mode: "insensitive" as const },
        })),
      },
      select: { releaseTitle: true },
    });
    return new Set(rows.map((r) => r.releaseTitle.toLowerCase()));
  } catch (e) {
    console.warn("[pickReleaseForGrab] blocklist lookup failed:", e);
    return new Set();
  }
}

export async function pickReleaseForGrab(opts: {
  candidates: NormalizedRelease[];
  profile: QualityProfileScoreInput | null;
  mediaContext: AiPickMediaContext;
  aiConfig: AiProviderConfig | null;
  feature?: AiFeature;
  trigger?: AiTrigger;
  mediaId?: number;
}): Promise<GrabPickResult | null> {
  const accepted = scoreReleasesForProfile(opts.candidates, opts.profile);
  // grabRelease refuses a blocklisted title without trying another, so neither
  // the classic choice nor the judge may land on one.
  const blocked = await blocklistedTitles(accepted.map((s) => s.release.title));
  const scored = accepted.filter(
    (s) => !blocked.has(s.release.title.toLowerCase()),
  );
  const classicBest = pickBestScored(scored);
  if (!classicBest) return null;

  // The judge never sees zero-seeder releases, so count only what it would get.
  const judgeable = scored.filter(
    (s) => s.release.seeders == null || s.release.seeders > 0,
  );
  if (!opts.aiConfig || judgeable.length < 2) {
    return { ...classicBest, picked_by: "classic" };
  }

  const aiPick = await pickReleaseWithAi(
    opts.aiConfig,
    opts.mediaContext,
    toAiPickReleases(scored),
    {
      feature: opts.feature ?? "release_pick_rss",
      trigger: opts.trigger ?? "rss",
      classicTitle: classicBest.release.title,
      mediaId: opts.mediaId,
    },
  );
  if (!aiPick) {
    return { ...classicBest, picked_by: "classic" };
  }

  return (
    resolveAiPick(scored, aiPick) ?? { ...classicBest, picked_by: "classic" }
  );
}
