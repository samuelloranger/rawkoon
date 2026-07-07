import { prisma } from "@rawkoon/api/db";
import { getActiveIndexerManager } from "@rawkoon/api/services/indexerManager/factory";
import type { NormalizedRelease } from "@rawkoon/api/services/indexerManager/types";
import type { RssRunStats } from "@rawkoon/api/services/rssRunStatus";
import { grabRelease } from "@rawkoon/api/services/mediaGrabberGrab";
import { loadEnabledLocalAiConfig } from "@rawkoon/api/services/localAi/client";
import {
  normalizeTitleForMatch,
  parseReleaseSeasonEpisode,
} from "@rawkoon/api/utils/medias/filenameParser";
import { pickReleaseForGrab } from "@rawkoon/api/utils/medias/pickReleaseForGrab";
import {
  profileToScoreInput,
  qualityProfileFormatsInclude,
} from "@rawkoon/api/services/mediaGrabberHelpers";
import type { AiPickMediaContext } from "@rawkoon/api/utils/medias/buildAiPickPrompt";
import {
  APP_DISPLAY_TIMEZONE,
  localDateYmd,
  toUtcMidnightDate,
} from "@rawkoon/shared/utils/date";

export async function pollIndexerRss(): Promise<RssRunStats | null> {
  const adapter = await getActiveIndexerManager();
  if (!adapter) return null;

  const integration = await prisma.integration.findFirst({
    where: { type: adapter.name, enabled: true },
  });
  if (!integration) return null;

  const rawConfig = integration.config as Record<string, unknown>;
  const rssIndexers = Array.isArray(rawConfig?.rss_indexers)
    ? (rawConfig.rss_indexers as unknown[]).filter(
        (v): v is string => typeof v === "string",
      )
    : [];

  if (!rssIndexers.length) return null;

  console.log(
    `[pollIndexerRss] Polling ${adapter.name} RSS for indexers: ${rssIndexers.join(", ")}`,
  );

  const aiConfig = await loadEnabledLocalAiConfig();
  if (aiConfig) {
    console.log(
      "[pollIndexerRss] Local AI enabled — will use AI pick with classic fallback",
    );
  }

  const releases = await adapter.fetchRss(rssIndexers);
  if (!releases.length) {
    console.log("[pollIndexerRss] No releases in RSS feed");
    return {
      releases_found: 0,
      releases_grabbed: 0,
      releases_grabbed_by_ai: 0,
      indexers: [],
    };
  }

  const indexerCounts = new Map<string, number>();
  for (const r of releases) {
    const name = r.indexer ?? "Unknown";
    indexerCounts.set(name, (indexerCounts.get(name) ?? 0) + 1);
  }

  const todayCutoff = toUtcMidnightDate(localDateYmd(APP_DISPLAY_TIMEZONE));
  const nowMinusGrace = new Date(Date.now() - 60 * 60 * 1000);
  const episodeCutoff = toUtcMidnightDate(
    localDateYmd(APP_DISPLAY_TIMEZONE, nowMinusGrace),
  );

  const [wantedMovies, wantedEpisodes] = await Promise.all([
    prisma.libraryMedia.findMany({
      where: {
        type: "movie",
        status: "wanted",
        monitored: true,
        files: { none: {} },
        digitalReleaseDate: { lte: todayCutoff },
      },
      select: { id: true, title: true, year: true, qualityProfileId: true },
    }),
    prisma.libraryEpisode.findMany({
      where: {
        status: "wanted",
        monitored: true,
        airDate: { lte: episodeCutoff },
        files: { none: {} },
        media: { type: "show", monitored: true },
      },
      include: {
        media: {
          select: { id: true, title: true, qualityProfileId: true },
        },
      },
    }),
  ]);

  const normalizedMovies = wantedMovies.map((m) => ({
    ...m,
    normalizedTitle: normalizeTitleForMatch(m.title),
  }));
  const normalizedEpisodes = wantedEpisodes.map((ep) => ({
    ...ep,
    normalizedTitle: normalizeTitleForMatch(ep.media.title),
  }));

  // Build season-pack eligibility map: seasons where every monitored episode
  // is wanted + aired + no files (same invariant as checkEpisodeReleases).
  type PackEligibleSeason = {
    mediaId: number;
    season: number;
    media: { id: number; title: string; qualityProfileId: number | null };
  };
  const packEligibleSeasons = new Map<string, PackEligibleSeason>();
  {
    const seasonGroups = new Map<
      string,
      (typeof normalizedEpisodes)[number][]
    >();
    for (const ep of normalizedEpisodes) {
      const key = `${ep.mediaId}:${ep.season}`;
      const list = seasonGroups.get(key) ?? [];
      list.push(ep);
      seasonGroups.set(key, list);
    }
    if (seasonGroups.size > 0) {
      const pairs = [...seasonGroups.values()].map((eps) => ({
        mediaId: eps[0]!.mediaId,
        season: eps[0]!.season,
      }));
      const monitoredEps = await prisma.libraryEpisode.findMany({
        where: { OR: pairs, monitored: true },
        select: { mediaId: true, season: true },
      });
      const monitoredCountMap = new Map<string, number>();
      for (const ep of monitoredEps) {
        const key = `${ep.mediaId}:${ep.season}`;
        monitoredCountMap.set(key, (monitoredCountMap.get(key) ?? 0) + 1);
      }
      for (const [, groupEps] of seasonGroups) {
        const ep0 = groupEps[0]!;
        const totalMonitored =
          monitoredCountMap.get(`${ep0.mediaId}:${ep0.season}`) ?? 0;
        if (groupEps.length === totalMonitored) {
          packEligibleSeasons.set(`${ep0.normalizedTitle}:${ep0.season}`, {
            mediaId: ep0.mediaId,
            season: ep0.season,
            media: ep0.media,
          });
        }
      }
    }
  }

  // Collect all matching RSS releases per episode/movie/season-pack before scoring.
  // Multiple releases across indexers may match the same item.
  const seasonPackCandidates = new Map<
    string,
    { match: PackEligibleSeason; releases: NormalizedRelease[] }
  >();
  const episodeCandidates = new Map<
    number,
    {
      match: (typeof normalizedEpisodes)[number];
      releases: NormalizedRelease[];
    }
  >();
  const movieCandidates = new Map<
    number,
    {
      match: (typeof normalizedMovies)[number];
      releases: NormalizedRelease[];
    }
  >();

  for (const release of releases) {
    const parsed = extractTitleFromRelease(release.title);
    if (!parsed) continue;

    if (parsed.season !== null && parsed.episode === null) {
      // Season pack — match against pack-eligible seasons
      const packKey = `${parsed.normalizedTitle}:${parsed.season}`;
      const pack = packEligibleSeasons.get(packKey);
      if (!pack) continue;
      const key = `${pack.mediaId}:${pack.season}`;
      const entry = seasonPackCandidates.get(key);
      if (entry) entry.releases.push(release);
      else seasonPackCandidates.set(key, { match: pack, releases: [release] });
      continue;
    }

    if (parsed.season !== null && parsed.episode !== null) {
      const match = normalizedEpisodes.find(
        (ep) =>
          ep.normalizedTitle === parsed.normalizedTitle &&
          ep.season === parsed.season &&
          ep.episode === parsed.episode,
      );
      if (match) {
        const entry = episodeCandidates.get(match.id);
        if (entry) {
          entry.releases.push(release);
        } else {
          episodeCandidates.set(match.id, { match, releases: [release] });
        }
      }
    } else {
      const match = normalizedMovies.find((m) => {
        if (m.normalizedTitle !== parsed.normalizedTitle) return false;
        if (parsed.year !== null && m.year !== null)
          return m.year === parsed.year;
        return true;
      });
      if (match) {
        const entry = movieCandidates.get(match.id);
        if (entry) {
          entry.releases.push(release);
        } else {
          movieCandidates.set(match.id, { match, releases: [release] });
        }
      }
    }
  }

  // Batch-load all quality profiles needed across episodes, movies, and season packs.
  const profileIds = new Set<number>();
  for (const { match } of episodeCandidates.values()) {
    if (match.media.qualityProfileId != null)
      profileIds.add(match.media.qualityProfileId);
  }
  for (const { match } of movieCandidates.values()) {
    if (match.qualityProfileId != null) profileIds.add(match.qualityProfileId);
  }
  for (const { match } of seasonPackCandidates.values()) {
    if (match.media.qualityProfileId != null)
      profileIds.add(match.media.qualityProfileId);
  }

  const profiles = await prisma.qualityProfile.findMany({
    where: { id: { in: [...profileIds] } },
    include: qualityProfileFormatsInclude,
  });
  const profileMap = new Map(profiles.map((p) => [p.id, p]));

  type GrabResult = { grabbed: boolean; ai: boolean };

  async function processGrabMatch(
    candidates: NormalizedRelease[],
    profileId: number | null,
    mediaContext: AiPickMediaContext,
    label: string,
    grabArgs: Omit<
      Parameters<typeof grabRelease>[0],
      | "grabSource"
      | "aiPicked"
      | "aiReasoning"
      | "downloadUrl"
      | "releaseTitle"
      | "indexer"
    >,
    warnTag: string,
  ): Promise<GrabResult> {
    const profile = profileId ? profileMap.get(profileId) : null;
    const profileInput = profile ? profileToScoreInput(profile) : null;

    const best = await pickReleaseForGrab({
      candidates,
      profile: profileInput,
      mediaContext,
      aiConfig,
    });

    if (!best) {
      console.log(
        `[pollIndexerRss] No qualifying release for ${label} (${candidates.length} candidate(s) rejected by profile)`,
      );
      return { grabbed: false, ai: false };
    }

    logRssMatch(best, label);

    grabRelease({
      ...grabArgs,
      downloadUrl: best.downloadUrl,
      releaseTitle: best.release.title,
      indexer: best.release.indexer,
      grabSource: "rss",
      aiPicked: best.picked_by === "ai",
      aiReasoning: best.ai_reasoning,
    }).catch((e) =>
      console.warn(`[pollIndexerRss] grab failed for ${warnTag}:`, e),
    );

    return { grabbed: true, ai: best.picked_by === "ai" };
  }

  const [episodeResults, movieResults, seasonPackResults] = await Promise.all([
    Promise.all(
      [...episodeCandidates.values()].map(({ match, releases: candidates }) =>
        processGrabMatch(
          candidates,
          match.media.qualityProfileId,
          tvMediaContext(match.media.title),
          `${match.media.title} S${match.season}E${match.episode}`,
          { mediaId: match.media.id, episodeId: match.id },
          `episode ${match.id}`,
        ),
      ),
    ),
    Promise.all(
      [...movieCandidates.values()].map(({ match, releases: candidates }) =>
        processGrabMatch(
          candidates,
          match.qualityProfileId,
          movieMediaContext(match.title, match.year),
          `${match.title} (${match.year})`,
          { mediaId: match.id },
          `movie ${match.id}`,
        ),
      ),
    ),
    Promise.all(
      [...seasonPackCandidates.values()].map(
        ({ match, releases: candidates }) =>
          processGrabMatch(
            candidates,
            match.media.qualityProfileId,
            tvMediaContext(match.media.title),
            `season pack ${match.media.title} S${match.season}`,
            { mediaId: match.media.id },
            `season pack ${match.mediaId} S${match.season}`,
          ),
      ),
    ),
  ]);

  const allResults = [...episodeResults, ...movieResults, ...seasonPackResults];
  const grabbed = allResults.filter((r) => r.grabbed).length;
  const grabbedByAi = allResults.filter((r) => r.ai).length;

  console.log(
    `[pollIndexerRss] Triggered ${grabbed} grab(s) from ${releases.length} RSS release(s)` +
      (grabbedByAi > 0 ? ` (${grabbedByAi} via AI pick)` : ""),
  );

  return {
    releases_found: releases.length,
    releases_grabbed: grabbed,
    releases_grabbed_by_ai: grabbedByAi,
    indexers: Array.from(indexerCounts.entries()).map(
      ([name, releases_found]) => ({
        name,
        releases_found,
      }),
    ),
  };
}

function tvMediaContext(title: string): AiPickMediaContext {
  return { title, year: null, type: "tv" };
}

function movieMediaContext(
  title: string,
  year: number | null,
): AiPickMediaContext {
  return { title, year, type: "movie" };
}

function logRssMatch(
  best: Awaited<ReturnType<typeof pickReleaseForGrab>> & object,
  label: string,
) {
  const via = best.picked_by === "ai" ? "AI pick" : `score: ${best.score}`;
  console.log(
    `[pollIndexerRss] Match: "${best.release.title}" → ${label} (${via})`,
  );
}

function extractTitleFromRelease(title: string): {
  normalizedTitle: string;
  season: number | null;
  episode: number | null;
  year: number | null;
} | null {
  if (!title) return null;

  const spaced = title.replace(/[._]/g, " ");
  const seInfo = parseReleaseSeasonEpisode(title);

  if (seInfo) {
    const seMatch = spaced.match(/S\d{1,2}E?\d{0,3}|S\d{1,2}$/i);
    const rawTitle =
      seMatch?.index !== undefined
        ? spaced.slice(0, seMatch.index).trim()
        : spaced;
    return {
      normalizedTitle: normalizeTitleForMatch(rawTitle),
      season: seInfo.season,
      episode: seInfo.episode,
      year: null,
    };
  }

  const yearMatch = spaced.match(/\b(19|20)\d{2}\b/);

  // Quality boundary markers present even without a year token
  const qualityBoundary = spaced.match(
    /\b(?:BluRay|BDRip|BRRip|WEB[-. ]?DL|WEBRip|WEB|HDRip|HDTV|DVDRip|DVD|4K|2160p|1080p|720p|480p|REMUX|PROPER|REPACK|EXTENDED|THEATRICAL|MULTI|VFF|VF2|VFQ|VFI|FRENCH|ENGLISH|MULTi)\b/i,
  );

  const boundary =
    yearMatch?.index !== undefined
      ? yearMatch.index
      : qualityBoundary?.index !== undefined
        ? qualityBoundary.index
        : spaced.length;

  const rawTitle = spaced.slice(0, boundary).trim();
  if (!rawTitle) return null;

  return {
    normalizedTitle: normalizeTitleForMatch(rawTitle),
    season: null,
    episode: null,
    year: yearMatch ? parseInt(yearMatch[0], 10) : null,
  };
}
