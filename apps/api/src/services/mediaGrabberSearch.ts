import { prisma } from "@rawkoon/api/db";
import type { AiTrigger } from "@rawkoon/shared/types";
import type { AiProviderConfig } from "@rawkoon/api/utils/integrations/types";
import {
  loadEnabledAiProviderConfig,
  pickReleaseWithAi,
} from "@rawkoon/api/services/aiProvider/client";
import { getActiveIndexerManager } from "@rawkoon/api/services/indexerManager";
import {
  parseReleaseSeasonEpisode,
  parseReleaseTitle,
} from "@rawkoon/api/utils/medias/filenameParser";
import { scoreRelease } from "@rawkoon/api/utils/medias/releaseScorer";
import type { QualityProfileScoreInput } from "@rawkoon/api/utils/medias/releaseScorer";
import {
  profileToScoreInput,
  qualityProfileFormatsInclude,
  type CandidateRow,
} from "@rawkoon/api/services/mediaGrabberHelpers";
import { grabRelease } from "@rawkoon/api/services/mediaGrabberGrab";
import {
  releaseMatchesExpectedTitles,
  resolveSearchTitles,
} from "@rawkoon/api/utils/medias/resolveSearchTitles";

export async function searchAndGrab(opts: {
  mediaId: number;
  episodeId?: number;
  /** Set for season-pack searches — part of the grab target, see grabRelease. */
  season?: number | null;
  mediaType: "tv" | "movie";
  searchQuery: string;
  qualityProfileId: number | null;
  isUpgrade?: boolean;
  /** Recorded in the AI usage ledger; defaults to upgrade/manual_search from isUpgrade. */
  trigger?: AiTrigger;
  /** Pre-loaded by the fallback wrapper; undefined means load it here. */
  aiConfig?: AiProviderConfig | null;
}): Promise<
  { grabbed: true; releaseTitle: string } | { grabbed: false; reason: string }
> {
  try {
    const {
      mediaId,
      episodeId,
      season,
      mediaType,
      searchQuery,
      qualityProfileId,
      isUpgrade,
    } = opts;
    const trigger: AiTrigger =
      opts.trigger ?? (isUpgrade ? "upgrade" : "manual_search");
    const qTrim = searchQuery.trim();
    if (!qTrim) return { grabbed: false, reason: "Empty search query" };

    const adapter = await getActiveIndexerManager();
    if (!adapter) {
      return { grabbed: false, reason: "No indexer manager configured" };
    }

    const { releases } = await adapter.search({
      query: qTrim,
      type: "freetext",
      mediaType,
      limit: 100,
    });

    if (releases.length === 0) {
      return { grabbed: false, reason: "No matching releases found" };
    }

    // Guard against indexers returning releases for a different show/episode
    // when the freetext query contains a short/common word (e.g. "FROM").
    const media = await prisma.libraryMedia.findUnique({
      where: { id: mediaId },
      select: {
        title: true,
        year: true,
        type: true,
        searchTitle: true,
        originalTitle: true,
      },
    });
    const { matchTitles } = resolveSearchTitles({
      title: media?.title ?? "",
      searchTitle: media?.searchTitle ?? null,
      originalTitle: media?.originalTitle ?? null,
    });
    let expectedSeason: number | null = null;
    let expectedEpisode: number | null = null;
    if (episodeId != null) {
      const ep = await prisma.libraryEpisode.findUnique({
        where: { id: episodeId },
        select: { season: true, episode: true },
      });
      if (ep) {
        expectedSeason = ep.season;
        expectedEpisode = ep.episode;
      }
    }

    const rows: CandidateRow[] = [];

    let profileInput: QualityProfileScoreInput | null = null;
    if (qualityProfileId != null) {
      const prof = await prisma.qualityProfile.findUnique({
        where: { id: qualityProfileId },
        include: qualityProfileFormatsInclude,
      });
      if (prof) profileInput = profileToScoreInput(prof);
    }

    for (const release of releases) {
      if (release.rejected) continue;
      const title = release.title;
      if (!title) continue;
      const downloadUrl = release.magnetUrl ?? release.downloadUrl;
      if (!downloadUrl) continue;
      const parsed = parseReleaseTitle(title);
      const size = release.sizeBytes;

      if (parsed.isSample) continue;

      // Reject releases whose title doesn't begin with an expected show/movie
      // title (freetext indexer results are noisy for short titles like "FROM").
      if (!releaseMatchesExpectedTitles(title, matchTitles)) continue;

      // For episode grabs, require the release's SxxExx to match the episode.
      if (expectedSeason != null && expectedEpisode != null) {
        const se = parseReleaseSeasonEpisode(title);
        if (!se) continue;
        if (se.season !== expectedSeason) continue;
        if (se.episode == null || se.episode !== expectedEpisode) continue;
      }

      if (profileInput) {
        const sc = scoreRelease(
          parsed,
          profileInput,
          size,
          title,
          release.indexer,
          release.freeleech,
          release.seeders,
        );
        if (Array.isArray(sc)) continue;
        rows.push({
          raw: {
            _downloadUrl: downloadUrl,
            _isMagnet: Boolean(release.magnetUrl),
          },
          parsed,
          score: sc,
          title,
          size,
          seeders: release.seeders,
        });
      } else {
        rows.push({
          raw: {
            _downloadUrl: downloadUrl,
            _isMagnet: Boolean(release.magnetUrl),
          },
          parsed,
          score: 0,
          title,
          size,
          seeders: release.seeders,
        });
      }
    }

    rows.sort((a, b) => b.score - a.score);

    if (rows.length === 0) {
      return { grabbed: false, reason: "No matching releases found" };
    }

    // Pre-filter blocklisted titles so we don't waste the grab attempt on them.
    // Scope the query to the candidate titles actually being checked rather
    // than loading the entire blocklist into memory on every search. Match
    // case-insensitively (Postgres `in` is case-sensitive) so an entry that
    // differs only by casing still suppresses the release.
    // Hash-based blocklist is a secondary check inside grabRelease itself.
    const candidateTitles = rows.map((r) => r.title);
    const blocklistTitles = await prisma.grabBlocklist
      .findMany({
        where: {
          OR: candidateTitles.map((title) => ({
            releaseTitle: { equals: title, mode: "insensitive" as const },
          })),
        },
        select: { releaseTitle: true },
      })
      .then((rows) => new Set(rows.map((r) => r.releaseTitle.toLowerCase())));

    const viable = rows.filter(
      (r) => !blocklistTitles.has(r.title.toLowerCase()) && r.raw._downloadUrl,
    );

    let aiRow: CandidateRow | null = null;
    if (viable.length >= 2) {
      const aiConfig =
        opts.aiConfig !== undefined
          ? opts.aiConfig
          : await loadEnabledAiProviderConfig().catch(() => null);
      if (aiConfig) {
        const pick = await pickReleaseWithAi(
          aiConfig,
          {
            title: media?.title ?? "",
            year: media?.year ?? null,
            type: media?.type ?? mediaType,
            preferred_languages: profileInput?.preferredLanguages,
            season: expectedSeason ?? season ?? null,
            episode: expectedEpisode,
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
            trigger,
            classicTitle: viable[0]!.title,
            mediaId,
          },
        ).catch(() => null);
        aiRow = pick ? (viable[Number(pick.release_key)] ?? null) : null;
      }
    }

    // The AI pick goes first; the rest keep the classic order as fallbacks.
    const ordered = aiRow
      ? [aiRow, ...viable.filter((r) => r !== aiRow)]
      : viable;

    for (const candidate of ordered) {
      const downloadUrl = candidate.raw._downloadUrl;

      const result = await grabRelease({
        mediaId,
        episodeId,
        season,
        downloadUrl,
        releaseTitle: candidate.title,
        indexer: null,
        qualityParsed: candidate.parsed,
        isUpgrade,
        aiPicked: candidate === aiRow,
      });

      if (result.grabbed) return result;

      // Only continue to the next candidate on a hash-level blocklist hit.
      // All other failures (network, download client) are terminal.
      if (!result.grabbed && result.reason.startsWith("Blocklisted:")) continue;

      return result;
    }

    return { grabbed: false, reason: "No matching releases found" };
  } catch (e) {
    console.warn("[mediaGrabber] searchAndGrab failed:", e);
    return {
      grabbed: false,
      reason:
        e instanceof Error ? e.message : "Unexpected error during search/grab",
    };
  }
}

/**
 * Try each base title (preferred → original) with the same suffix.
 * Counts as a single logical attempt for cron callers.
 * Only continues to the next title when the previous search found no matching
 * releases — terminal grab/infra errors stop immediately.
 */
export async function searchAndGrabWithTitleFallback(opts: {
  mediaId: number;
  episodeId?: number;
  /** Set for season-pack searches — part of the grab target, see grabRelease. */
  season?: number | null;
  mediaType: "tv" | "movie";
  titleBaseQueries: string[];
  suffix: string;
  qualityProfileId: number | null;
  isUpgrade?: boolean;
  /** Recorded in the AI usage ledger; defaults to upgrade/manual_search from isUpgrade. */
  trigger?: AiTrigger;
}): Promise<
  { grabbed: true; releaseTitle: string } | { grabbed: false; reason: string }
> {
  let lastReason = "No matching releases found";
  const aiConfig = await loadEnabledAiProviderConfig().catch(() => null);
  for (const base of opts.titleBaseQueries) {
    const result = await searchAndGrab({
      mediaId: opts.mediaId,
      episodeId: opts.episodeId,
      season: opts.season,
      mediaType: opts.mediaType,
      searchQuery: `${base}${opts.suffix}`,
      qualityProfileId: opts.qualityProfileId,
      isUpgrade: opts.isUpgrade,
      trigger: opts.trigger,
      aiConfig,
    });
    if (result.grabbed) return result;
    lastReason = result.reason;
    if (result.reason !== "No matching releases found") return result;
  }
  return { grabbed: false, reason: lastReason };
}
