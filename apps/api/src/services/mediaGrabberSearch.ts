import { prisma } from "@rawkoon/api/db";
import { getActiveIndexerManager } from "@rawkoon/api/services/indexerManager";
import {
  normalizeTitleForMatch,
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

export async function searchAndGrab(opts: {
  mediaId: number;
  episodeId?: number;
  mediaType: "tv" | "movie";
  searchQuery: string;
  qualityProfileId: number | null;
  isUpgrade?: boolean;
}): Promise<
  { grabbed: true; releaseTitle: string } | { grabbed: false; reason: string }
> {
  try {
    const {
      mediaId,
      episodeId,
      mediaType,
      searchQuery,
      qualityProfileId,
      isUpgrade,
    } = opts;
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
      select: { title: true },
    });
    const expectedTitle = media?.title
      ? normalizeTitleForMatch(media.title)
      : null;
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

      // Reject releases whose title doesn't begin with the expected show/movie
      // title (freetext indexer results are noisy for short titles like "FROM").
      if (expectedTitle) {
        const normalizedRelease = normalizeTitleForMatch(title);
        if (!normalizedRelease.startsWith(`${expectedTitle} `)) continue;
      }

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

    for (const candidate of rows) {
      if (blocklistTitles.has(candidate.title.toLowerCase())) continue;

      const downloadUrl = candidate.raw._downloadUrl;
      if (!downloadUrl) continue;

      const result = await grabRelease({
        mediaId,
        episodeId,
        downloadUrl,
        releaseTitle: candidate.title,
        indexer: null,
        qualityParsed: candidate.parsed,
        isUpgrade,
      });

      if (result.grabbed) return result;

      // Only continue to the next candidate on a hash-level blocklist hit.
      // All other failures (network, qBittorrent) are terminal.
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
