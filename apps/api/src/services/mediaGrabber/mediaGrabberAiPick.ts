import {
  loadEnabledAiProviderConfig,
  pickReleaseWithAi,
} from "@rawkoon/api/services/aiProvider/client";
import type { CandidateRow } from "@rawkoon/api/services/mediaGrabber/mediaGrabberHelpers";
import type { AiProviderConfig } from "@rawkoon/api/utils/integrations/types";
import type { QualityProfileScoreInput } from "@rawkoon/api/utils/medias/releaseScorer";
import type { AiTrigger } from "@rawkoon/shared/types";

/** The release the AI provider prefers among the viable ones, or null when it is off, unsure or errors. */
export async function pickAiRow(opts: {
  viable: CandidateRow[];
  /** Pre-loaded by the fallback wrapper; undefined means load it here. */
  aiConfig: AiProviderConfig | null | undefined;
  media: { title: string; year: number | null; type: string } | null;
  mediaType: "tv" | "movie";
  profileInput: QualityProfileScoreInput | null;
  trigger: AiTrigger;
  mediaId: number;
  season: number | null;
  episode: number | null;
}): Promise<CandidateRow | null> {
  const { viable, media, profileInput } = opts;
  if (viable.length < 2) return null;
  const aiConfig =
    opts.aiConfig !== undefined
      ? opts.aiConfig
      : await loadEnabledAiProviderConfig().catch(() => null);
  if (!aiConfig) return null;
  const pick = await pickReleaseWithAi(
    aiConfig,
    {
      title: media?.title ?? "",
      year: media?.year ?? null,
      type: media?.type ?? opts.mediaType,
      preferred_languages: profileInput?.preferredLanguages,
      season: opts.season,
      episode: opts.episode,
    },
    // Index keys: two results can share a download URL under different titles.
    viable.map((r, i) => ({
      key: String(i),
      title: r.title,
      size_bytes: r.size,
      seeders: r.seeders,
      score: profileInput ? r.score : null,
    })),
    {
      feature: "release_pick_search",
      trigger: opts.trigger,
      classicTitle: viable[0]!.title,
      mediaId: opts.mediaId,
    },
  ).catch(() => null);
  return pick ? (viable[Number(pick.release_key)] ?? null) : null;
}
