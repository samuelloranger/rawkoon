import { prisma } from "@rawkoon/api/db";
import { getActiveIndexerManager } from "@rawkoon/api/services/indexerManager/factory";
import type { NormalizedRelease } from "@rawkoon/api/services/indexerManager/types";
import type { RssRunStats } from "@rawkoon/api/services/rss/rssRunStatus";
import { grabRelease } from "@rawkoon/api/services/mediaGrabber/mediaGrabberGrab";
import { loadEnabledAiProviderConfig } from "@rawkoon/api/services/aiProvider/client";
import {
  clearPending,
  delaySettingsOf,
  evaluateDelay,
  toDelayCandidate,
} from "@rawkoon/api/services/grab/grabDelay";
import { scoreReleasesForProfile } from "@rawkoon/api/utils/medias/pickBestRelease";
import { pickReleaseForGrab } from "@rawkoon/api/utils/medias/pickReleaseForGrab";
import { mapPool } from "@rawkoon/api/utils/medias/fileFingerprint";

/**
 * Matches used to fan out unbounded, which on a bulk import fired every AI judge
 * call at once. A hosted provider rate-limits that; bound the burst instead.
 */
const GRAB_CONCURRENCY = 3;
import {
  profileToScoreInput,
  qualityProfileFormatsInclude,
} from "@rawkoon/api/services/mediaGrabber/mediaGrabberHelpers";
import type { AiPickMediaContext } from "@rawkoon/api/utils/medias/buildAiPickPrompt";
import {
  extractTitleFromRelease,
  logRssMatch,
  matchableRssRelease,
  movieMediaContext,
  normalizedTitleSet,
  titleMatches,
  tvMediaContext,
} from "@rawkoon/api/workers/rssReleaseMatching";
import { pollIndexerRssBooks } from "@rawkoon/api/workers/pollIndexerRssBooks";
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

  const aiConfig = await loadEnabledAiProviderConfig();
  if (aiConfig) {
    console.log(
      "[pollIndexerRss] AI Provider enabled — will use AI pick with classic fallback",
    );
  }

  // Books run their own pass over categories 7000 + 3000 (no-op unless the
  // feature is enabled). Done before the media early-return so a feed with no
  // movie or TV releases still gets its books swept.
  const bookStats = await pollIndexerRssBooks(adapter, rssIndexers);

  const releases = await adapter.fetchRss(rssIndexers);
  if (!releases.length) {
    console.log("[pollIndexerRss] No releases in media RSS feed");
    return {
      releases_found: bookStats.found,
      releases_grabbed: bookStats.grabbed,
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
      select: {
        id: true,
        title: true,
        searchTitle: true,
        originalTitle: true,
        year: true,
        qualityProfileId: true,
      },
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
          select: {
            id: true,
            title: true,
            searchTitle: true,
            originalTitle: true,
            qualityProfileId: true,
          },
        },
      },
    }),
  ]);

  const normalizedMovies = wantedMovies.map((m) => ({
    ...m,
    normalizedTitles: normalizedTitleSet({
      title: m.title,
      searchTitle: m.searchTitle,
      originalTitle: m.originalTitle,
    }),
  }));
  const normalizedEpisodes = wantedEpisodes.map((ep) => ({
    ...ep,
    normalizedTitles: normalizedTitleSet({
      title: ep.media.title,
      searchTitle: ep.media.searchTitle,
      originalTitle: ep.media.originalTitle,
    }),
  }));

  // Build season-pack eligibility map: seasons where every monitored episode
  // is wanted + aired + no files (same invariant as checkEpisodeReleases).
  type PackEligibleSeason = {
    mediaId: number;
    season: number;
    media: {
      id: number;
      title: string;
      qualityProfileId: number | null;
    };
    normalizedTitles: Set<string>;
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
          packEligibleSeasons.set(`${ep0.mediaId}:${ep0.season}`, {
            mediaId: ep0.mediaId,
            season: ep0.season,
            media: ep0.media,
            normalizedTitles: ep0.normalizedTitles,
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
    const parsed = matchableRssRelease(release.title);
    if (!parsed) continue;

    if (parsed.season !== null && parsed.episode === null) {
      // Season pack — match against pack-eligible seasons
      let pack: PackEligibleSeason | undefined;
      for (const candidate of packEligibleSeasons.values()) {
        if (
          candidate.season === parsed.season &&
          titleMatches(candidate.normalizedTitles, parsed)
        ) {
          pack = candidate;
          break;
        }
      }
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
          titleMatches(ep.normalizedTitles, parsed) &&
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
        if (!titleMatches(m.normalizedTitles, parsed)) return false;
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

    // Decide before the AI pick so a held-back match doesn't spend a judge call every poll.
    const delaySettings = delaySettingsOf(profile);
    if (profileInput && delaySettings.minutes > 0) {
      try {
        const decision = await evaluateDelay({
          target: {
            mediaId: grabArgs.mediaId,
            episodeId: grabArgs.episodeId ?? null,
            season: grabArgs.season ?? null,
          },
          settings: delaySettings,
          cutoffResolution: profileInput.cutoffResolution,
          source: "rss",
          candidates: scoreReleasesForProfile(candidates, profileInput).map(
            (s) => toDelayCandidate(s.release, s.score),
          ),
        });
        if (decision.delay) {
          console.log(
            `[pollIndexerRss] Holding ${label} until ${decision.grabAfter.toISOString()} (grab delay)`,
          );
          return { grabbed: false, ai: false };
        }
      } catch (e) {
        console.warn(`[pollIndexerRss] delay check failed for ${warnTag}:`, e);
      }
    }

    const best = await pickReleaseForGrab({
      candidates,
      profile: profileInput,
      mediaContext: { ...mediaContext, profile: profileInput },
      aiConfig,
      feature: "release_pick_rss",
      trigger: "rss",
      mediaId: grabArgs.mediaId,
    });

    if (!best) {
      console.log(
        `[pollIndexerRss] No qualifying release for ${label} (${candidates.length} candidate(s) rejected by profile)`,
      );
      return { grabbed: false, ai: false };
    }

    logRssMatch(best, label);

    // Await the grab so the run status counts real grabs, not picks: grabRelease
    // returns grabbed:false (blocklisted, duplicate active target, fetch failure)
    // without throwing, and reporting a pick as a grab overstates the RSS result.
    let didGrab = false;
    try {
      const result = await grabRelease({
        ...grabArgs,
        downloadUrl: best.downloadUrl,
        releaseTitle: best.release.title,
        indexer: best.release.indexer,
        grabSource: "rss",
        sizeBytes: best.release.sizeBytes,
        aiPicked: best.picked_by === "ai",
        aiReasoning: best.ai_reasoning,
      });
      didGrab = result.grabbed;
      // Only profiles with a delay ever hold rows; delay 0 stays query-for-query as before.
      if (didGrab && delaySettings.minutes > 0) {
        await clearPending({
          mediaId: grabArgs.mediaId,
          episodeId: grabArgs.episodeId ?? null,
          season: grabArgs.season ?? null,
        }).catch(() => {});
      }
    } catch (e) {
      console.warn(`[pollIndexerRss] grab failed for ${warnTag}:`, e);
    }

    return { grabbed: didGrab, ai: didGrab && best.picked_by === "ai" };
  }

  // A season pack and its own episodes must not both grab: when a pack release
  // matched a season in this feed, drop that season's per-episode candidates
  // (mirrors checkEpisodeReleases' pack/individual mutual exclusion).
  for (const [id, entry] of episodeCandidates) {
    if (
      seasonPackCandidates.has(`${entry.match.mediaId}:${entry.match.season}`)
    ) {
      episodeCandidates.delete(id);
    }
  }

  const grabTasks: Array<() => Promise<GrabResult>> = [
    ...[...episodeCandidates.values()].map(
      ({ match, releases: candidates }) =>
        () =>
          processGrabMatch(
            candidates,
            match.media.qualityProfileId,
            tvMediaContext(match.media.title, match.season, match.episode),
            `${match.media.title} S${match.season}E${match.episode}`,
            { mediaId: match.media.id, episodeId: match.id },
            `episode ${match.id}`,
          ),
    ),
    ...[...movieCandidates.values()].map(
      ({ match, releases: candidates }) =>
        () =>
          processGrabMatch(
            candidates,
            match.qualityProfileId,
            movieMediaContext(match.title, match.year),
            `${match.title} (${match.year})`,
            { mediaId: match.id },
            `movie ${match.id}`,
          ),
    ),
    ...[...seasonPackCandidates.values()].map(
      ({ match, releases: candidates }) =>
        () =>
          processGrabMatch(
            candidates,
            match.media.qualityProfileId,
            tvMediaContext(match.media.title, match.season),
            `season pack ${match.media.title} S${match.season}`,
            { mediaId: match.media.id, season: match.season },
            `season pack ${match.mediaId} S${match.season}`,
          ),
    ),
  ];

  const allResults = await mapPool(grabTasks, GRAB_CONCURRENCY, (task) =>
    task(),
  );
  const grabbed = allResults.filter((r) => r.grabbed).length;
  const grabbedByAi = allResults.filter((r) => r.ai).length;

  console.log(
    `[pollIndexerRss] Triggered ${grabbed} grab(s) from ${releases.length} RSS release(s)` +
      (grabbedByAi > 0 ? ` (${grabbedByAi} via AI pick)` : ""),
  );

  return {
    releases_found: releases.length + bookStats.found,
    releases_grabbed: grabbed + bookStats.grabbed,
    releases_grabbed_by_ai: grabbedByAi,
    indexers: Array.from(indexerCounts.entries()).map(
      ([name, releases_found]) => ({
        name,
        releases_found,
      }),
    ),
  };
}

export { extractTitleFromRelease, matchableRssRelease };
