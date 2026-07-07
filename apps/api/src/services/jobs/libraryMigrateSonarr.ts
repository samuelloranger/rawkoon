import { classifyLanguageTags, type LibraryAudioTrack } from "@rawkoon/shared";
import { prisma } from "@rawkoon/api/db";
import {
  scanMediaInfo,
  remapPath,
} from "@rawkoon/api/utils/medias/mediainfoScanner";
import { parseFilenameMetadata } from "@rawkoon/api/utils/medias/filenameParser";
import { sortTitleFromName } from "@rawkoon/api/utils/medias/libraryHelpers";
import {
  buildAudioTracksFromArr,
  buildSubtitleTracksFromArr,
  fileQualityScore,
  normalizeHdrFormat,
  normalizeVideoCodec,
  tmdbFetch,
} from "@rawkoon/api/services/jobs/libraryMigrateArrHelpers";
import type {
  LibraryMigrateContext,
  SonarrEp,
  SonarrFile,
  SonarrSeries,
} from "@rawkoon/api/services/jobs/libraryMigrateTypes";

export async function migrateFromSonarr(
  sonarrUrl: string,
  sonarrApiKey: string,
  ctx: LibraryMigrateContext,
): Promise<void> {
  const { tmdbConfig, defaultQualityProfileId, progress, result, push } = ctx;
  const sonarrErrors: string[] = [];
  result.sonarr = {
    imported_shows: 0,
    imported_episodes: 0,
    imported_files: 0,
    files_scanned: 0,
    errors: sonarrErrors,
  };

  try {
    const seriesRes = await fetch(`${sonarrUrl}/api/v3/series`, {
      headers: { "X-Api-Key": sonarrApiKey },
      signal: AbortSignal.timeout(30_000),
    });
    if (!seriesRes.ok) throw new Error(`Sonarr responded ${seriesRes.status}`);
    const allSeries = (await seriesRes.json()) as SonarrSeries[];

    progress.phase = "sonarr";
    progress.current = 0;
    progress.total = allSeries.length;
    await push();

    for (const series of allSeries) {
      progress.current++;
      progress.current_title = series.title;
      await push();

      try {
        if (!series.tvdbId) {
          sonarrErrors.push(`Series ${series.title}: no TVDB ID`);
          continue;
        }

        let tmdbId: number | null = null;
        if (tmdbConfig) {
          try {
            const findRes = await tmdbFetch<{
              tv_results: Array<{ id: number }>;
            }>(`find/${series.tvdbId}`, tmdbConfig.api_key, {
              external_source: "tvdb_id",
            });
            tmdbId = findRes.tv_results[0]?.id ?? null;
          } catch (e) {
            console.warn(
              `[libraryMigrate] TMDB find tvdb_id=${series.tvdbId}:`,
              e,
            );
          }
        }
        if (!tmdbId) {
          sonarrErrors.push(
            `Series ${series.title}: could not resolve TMDB ID from TVDB ${series.tvdbId}`,
          );
          continue;
        }

        const poster =
          series.images.find((i) => i.coverType === "poster")?.remoteUrl ??
          null;
        const hasAnyFile = series.seasons.some(
          (s) => (s.statistics?.episodeFileCount ?? 0) > 0,
        );

        const existing = await prisma.libraryMedia.findUnique({
          where: { tmdbId },
          select: { id: true, status: true },
        });

        const mediaRow = await prisma.libraryMedia.upsert({
          where: { tmdbId },
          create: {
            tmdbId,
            type: "show",
            title: series.title,
            sortTitle: sortTitleFromName(series.title),
            year: series.year || null,
            status: hasAnyFile ? "downloaded" : "wanted",
            posterUrl: poster,
            overview: series.overview || null,
            ...(series.added ? { addedAt: new Date(series.added) } : {}),
            ...(defaultQualityProfileId != null
              ? { qualityProfileId: defaultQualityProfileId }
              : {}),
          },
          update: {
            title: series.title,
            year: series.year || null,
            posterUrl: poster,
            status: existing
              ? existing.status === "wanted" || existing.status === "downloaded"
                ? hasAnyFile
                  ? "downloaded"
                  : "wanted"
                : existing.status
              : hasAnyFile
                ? "downloaded"
                : "wanted",
          },
        });

        progress.sonarr.imported_shows++;
        result.sonarr!.imported_shows++;

        const epsRes = await fetch(
          `${sonarrUrl}/api/v3/episode?seriesId=${series.id}`,
          {
            headers: { "X-Api-Key": sonarrApiKey },
            signal: AbortSignal.timeout(15_000),
          },
        );
        if (!epsRes.ok) throw new Error(`Sonarr episodes ${epsRes.status}`);
        const episodes = (await epsRes.json()) as SonarrEp[];

        const fileIdToEpNum = new Map<number, number>();
        for (const ep of episodes) {
          if (ep.episodeFileId)
            fileIdToEpNum.set(ep.episodeFileId, ep.episodeNumber);
        }

        const existingEpisodes = await prisma.libraryEpisode.findMany({
          where: { mediaId: mediaRow.id },
          select: { season: true, episode: true, status: true },
        });
        const existingEpisodesMap = new Map<string, string>();
        for (const exEp of existingEpisodes) {
          existingEpisodesMap.set(
            `${exEp.season}_${exEp.episode}`,
            exEp.status,
          );
        }

        for (const ep of episodes) {
          if (ep.seasonNumber === 0) continue;
          const key = `${ep.seasonNumber}_${ep.episodeNumber}`;
          const existingEpStatus = existingEpisodesMap.get(key);
          const newEpStatus = ep.hasFile ? "downloaded" : "wanted";
          const epStatusToSet = existingEpStatus
            ? existingEpStatus === "wanted" || existingEpStatus === "downloaded"
              ? newEpStatus
              : existingEpStatus
            : newEpStatus;

          await prisma.libraryEpisode.upsert({
            where: {
              mediaId_season_episode: {
                mediaId: mediaRow.id,
                season: ep.seasonNumber,
                episode: ep.episodeNumber,
              },
            },
            create: {
              mediaId: mediaRow.id,
              season: ep.seasonNumber,
              episode: ep.episodeNumber,
              title: ep.title || null,
              airDate: ep.airDate ? new Date(ep.airDate) : null,
              status: epStatusToSet,
            },
            update: {
              title: ep.title || null,
              airDate: ep.airDate ? new Date(ep.airDate) : null,
              status: epStatusToSet,
            },
          });
          progress.sonarr.imported_episodes++;
          result.sonarr!.imported_episodes++;
        }

        const filesRes = await fetch(
          `${sonarrUrl}/api/v3/episodefile?seriesId=${series.id}`,
          {
            headers: { "X-Api-Key": sonarrApiKey },
            signal: AbortSignal.timeout(15_000),
          },
        );
        if (filesRes.ok) {
          const files = (await filesRes.json()) as SonarrFile[];

          for (const file of files) {
            const filePath = remapPath(file.path);
            const fileName = filePath.split("/").pop() ?? "";

            const epMatch = fileName.match(/[Ss]\d{1,2}[Ee](\d{1,3})/);
            const epNumber = epMatch
              ? parseInt(epMatch[1], 10)
              : (fileIdToEpNum.get(file.id) ?? null);

            const epRow = await prisma.libraryEpisode.findFirst({
              where: {
                mediaId: mediaRow.id,
                season: file.seasonNumber,
                ...(epNumber != null ? { episode: epNumber } : {}),
              },
              select: { id: true },
            });

            const fnData = parseFilenameMetadata(fileName);

            const existingFile = await prisma.mediaFile.findFirst({
              where: epRow ? { episodeId: epRow.id } : { filePath },
              select: {
                id: true,
                resolution: true,
                hdrFormat: true,
                bitDepth: true,
              },
            });

            const mi = filePath ? await scanMediaInfo(filePath) : null;

            if (mi) {
              progress.sonarr.files_scanned++;
              result.sonarr!.files_scanned++;
              const miData = {
                episodeId: epRow?.id ?? null,
                mediaId: mediaRow.id,
                filePath,
                fileName,
                sizeBytes: mi.sizeBytes,
                durationSecs: mi.durationSecs,
                releaseGroup: file.releaseGroup ?? mi.releaseGroup,
                videoCodec: mi.videoCodec,
                videoProfile: mi.videoProfile,
                width: mi.width,
                height: mi.height,
                frameRate: mi.frameRate,
                bitDepth: mi.bitDepth,
                videoBitrate: mi.videoBitrate,
                hdrFormat: mi.hdrFormat ?? fnData.hdrFormat,
                resolution: mi.resolution ?? fnData.resolution,
                source: mi.source ?? fnData.source,
                audioTracks: mi.audioTracks as object[],
                subtitleTracks: mi.subtitleTracks as object[],
                languageTags: classifyLanguageTags(
                  mi.audioTracks as LibraryAudioTrack[],
                  null,
                ),
              };
              if (existingFile) {
                if (
                  fileQualityScore(miData) >= fileQualityScore(existingFile)
                ) {
                  await prisma.mediaFile.update({
                    where: { id: existingFile.id },
                    data: miData,
                  });
                }
              } else {
                await prisma.mediaFile.create({ data: miData });
              }
            } else {
              const arrMi = file.mediaInfo ?? {};
              const arrAudioTracks = buildAudioTracksFromArr(
                arrMi,
                fileName,
                file.languages,
              );
              const arrData = {
                episodeId: epRow?.id ?? null,
                mediaId: mediaRow.id,
                filePath,
                fileName,
                sizeBytes: BigInt(file.size ?? 0),
                releaseGroup: file.releaseGroup ?? null,
                videoCodec: normalizeVideoCodec(arrMi.videoCodec),
                width: arrMi.width ?? null,
                height: arrMi.height ?? null,
                bitDepth: arrMi.videoBitDepth ?? null,
                hdrFormat:
                  normalizeHdrFormat(arrMi.videoDynamicRangeType) ??
                  fnData.hdrFormat,
                resolution: fnData.resolution,
                source: fnData.source,
                audioTracks: arrAudioTracks,
                subtitleTracks: buildSubtitleTracksFromArr(arrMi),
                languageTags: classifyLanguageTags(
                  arrAudioTracks as LibraryAudioTrack[],
                  null,
                ),
              };
              if (existingFile) {
                if (
                  fileQualityScore(arrData) >= fileQualityScore(existingFile)
                ) {
                  await prisma.mediaFile.update({
                    where: { id: existingFile.id },
                    data: arrData,
                  });
                }
              } else {
                await prisma.mediaFile.create({ data: arrData });
              }
            }
            progress.sonarr.imported_files++;
            result.sonarr!.imported_files++;
          }
        }
      } catch (err) {
        progress.sonarr.errors++;
        sonarrErrors.push(
          `Series ${series.title}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  } catch (err) {
    result.sonarr!.errors.push(
      `Sonarr import failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
