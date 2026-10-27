import type {
  InteractiveReleaseItem,
  LanguageFallbackSummary,
  ScoreBreakdownDto,
} from "@rawkoon/shared/types";
import { prisma } from "@rawkoon/api/db";
import type { NormalizedRelease } from "@rawkoon/api/services/indexerManager";
import {
  profileToScoreInput,
  qualityProfileFormatsInclude,
} from "@rawkoon/api/services/mediaGrabber/mediaGrabberHelpers";
import { parseReleaseTitle } from "@rawkoon/api/utils/medias/filenameParser";
import {
  buildLanguageFallbackSummary,
  classifyLanguageFallback,
} from "@rawkoon/api/utils/medias/languageFallback";
import {
  isCompleteSeries,
  isSeasonPack,
} from "@rawkoon/api/utils/medias/mappers";
import { scoreReleaseDetailed } from "@rawkoon/api/utils/medias/releaseScorer";

export async function findEpisodeMediaId(
  episodeId: number,
): Promise<number | undefined> {
  const episode = await prisma.libraryEpisode.findUnique({
    where: { id: episodeId },
    select: { mediaId: true },
  });
  return episode?.mediaId;
}

export async function libraryMediaExists(id: number): Promise<boolean> {
  const media = await prisma.libraryMedia.findUnique({
    where: { id },
    select: { id: true },
  });
  return media !== null;
}

export function findMediaWithQualityProfile(id: number) {
  return prisma.libraryMedia.findUnique({
    where: { id },
    include: { qualityProfile: { include: qualityProfileFormatsInclude } },
  });
}

export function normalizedToInteractive(
  r: NormalizedRelease,
  source: "prowlarr" | "jackett",
  downloadToken: string | null,
): InteractiveReleaseItem {
  return {
    guid: r.guid,
    title: r.title,
    indexer: r.indexer,
    indexer_id: r.indexerId,
    languages: r.languages,
    protocol: r.protocol,
    size_bytes: r.sizeBytes,
    age: r.age,
    seeders: r.seeders,
    leechers: r.leechers,
    rejected: r.rejected,
    rejection_reason: r.rejections.length > 0 ? r.rejections.join(", ") : null,
    info_url: r.infoUrl,
    source,
    download_token: downloadToken,
    download_url: r.magnetUrl ?? r.downloadUrl ?? null,
    is_season_pack: isSeasonPack(r.title),
    is_complete_series: isCompleteSeries(r.title),
    freeleech: r.freeleech || undefined,
    language_fallback: false,
    language_fallback_tag: null,
  };
}

type ScoreProfile = ReturnType<typeof profileToScoreInput>;

/** Scores each release against the profile, then sorts accepted and best-scored first. */
export function applyQualityProfileToReleases(
  releases: InteractiveReleaseItem[],
  profile: ScoreProfile,
): {
  releases: InteractiveReleaseItem[];
  languageFallbackSummary: LanguageFallbackSummary | null;
} {
  let mapped = releases;
  let languageFallbackSummary: LanguageFallbackSummary | null = null;
  mapped = mapped.map((r) => {
    const parsed = parseReleaseTitle(r.title);
    const breakdown = scoreReleaseDetailed(
      {
        parsed,
        rawTitle: r.title,
        sizeBytes: r.size_bytes,
        indexerName: r.indexer,
        seeders: r.seeders,
        freeleech: Boolean(r.freeleech),
      },
      profile,
    );
    const qualityReject = breakdown.rejected;
    // An indexer-side rejection keeps the release out of the fallback group.
    const fallbackTag =
      !r.rejected && breakdown.rejected
        ? classifyLanguageFallback(
            r.title,
            breakdown.reasons.map((x) => x.code),
            profile.preferredLanguages,
          )
        : null;
    const parsed_quality = {
      resolution: parsed.resolution,
      source: parsed.source,
      codec: parsed.codec,
      hdr: parsed.hdr,
    };
    const rejected = r.rejected || qualityReject;
    let rejection_reason = r.rejection_reason;
    if (qualityReject) {
      const qmsg = breakdown.reasons.map((x) => x.code).join(", ");
      rejection_reason = rejection_reason
        ? `${rejection_reason}; ${qmsg}`
        : qmsg;
    }
    const score_breakdown: ScoreBreakdownDto = breakdown.rejected
      ? {
          rejected: true,
          total: null,
          components: [],
          matched_formats: [],
        }
      : {
          rejected: false,
          total: breakdown.total,
          components: breakdown.components.map((c) => ({
            code: c.code,
            value: c.value,
            ...(c.params ? { params: c.params } : {}),
          })),
          matched_formats: breakdown.matchedFormats,
        };
    return {
      ...r,
      quality_score: qualityReject ? null : breakdown.total,
      quality_rejection_reasons: qualityReject
        ? breakdown.reasons.map((x) => x.code)
        : null,
      parsed_quality,
      rejected,
      rejection_reason,
      score_breakdown,
      language_fallback: fallbackTag != null,
      language_fallback_tag: fallbackTag,
    };
  });
  if (!mapped.some((r) => !r.rejected)) {
    languageFallbackSummary = buildLanguageFallbackSummary(
      profile.preferredLanguages,
      mapped.flatMap((r) =>
        r.language_fallback_tag ? [r.language_fallback_tag] : [],
      ),
    );
  }
  mapped.sort((a, b) => {
    const ar = a.rejected ? 1 : 0;
    const br = b.rejected ? 1 : 0;
    if (ar !== br) return ar - br;
    const as = a.quality_score ?? -Number.MAX_SAFE_INTEGER;
    const bs = b.quality_score ?? -Number.MAX_SAFE_INTEGER;
    if (as !== bs) return bs - as;
    return a.title.localeCompare(b.title);
  });
  return { releases: mapped, languageFallbackSummary };
}
