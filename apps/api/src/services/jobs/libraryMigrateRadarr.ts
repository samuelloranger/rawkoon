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
  pickDigitalRelease,
  tmdbFetch,
} from "@rawkoon/api/services/jobs/libraryMigrateArrHelpers";
import type {
  LibraryMigrateContext,
  RadarrMovie,
} from "@rawkoon/api/services/jobs/libraryMigrateTypes";

export async function migrateFromRadarr(
  radarrUrl: string,
  radarrApiKey: string,
  ctx: LibraryMigrateContext,
): Promise<void> {
  const {
    tmdbConfig,
    defaultQualityProfileId,
    region,
    progress,
    result,
    push,
  } = ctx;
  const radarrErrors: string[] = [];
  result.radarr = {
    imported: 0,
    already_existed: 0,
    skipped: 0,
    files_scanned: 0,
    errors: radarrErrors,
  };

  try {
    const moviesRes = await fetch(`${radarrUrl}/api/v3/movie`, {
      headers: { "X-Api-Key": radarrApiKey },
      signal: AbortSignal.timeout(30_000),
    });
    if (!moviesRes.ok) throw new Error(`Radarr responded ${moviesRes.status}`);
    const movies = (await moviesRes.json()) as RadarrMovie[];

    progress.total = movies.length;
    await push();

    for (const movie of movies) {
      progress.current++;
      progress.current_title = movie.title;
      await push();

      try {
        if (!movie.tmdbId) {
          progress.radarr.skipped++;
          result.radarr!.skipped++;
          continue;
        }

        const poster =
          movie.images.find((i) => i.coverType === "poster")?.remoteUrl ?? null;

        const existing = await prisma.libraryMedia.findUnique({
          where: { tmdbId: movie.tmdbId },
          select: { id: true, status: true },
        });

        let digitalReleaseDate: Date | null = null;
        if (tmdbConfig) {
          try {
            const rd = await tmdbFetch<{
              results: Array<{
                iso_3166_1: string;
                release_dates: Array<{
                  type: number;
                  release_date: string;
                }>;
              }>;
            }>(`movie/${movie.tmdbId}/release_dates`, tmdbConfig.api_key);
            digitalReleaseDate = pickDigitalRelease(rd.results, region);
          } catch (e) {
            console.warn(
              `[libraryMigrate] TMDB release_dates movie=${movie.tmdbId}:`,
              e,
            );
          }
        }

        const mediaRow = await prisma.libraryMedia.upsert({
          where: { tmdbId: movie.tmdbId },
          create: {
            tmdbId: movie.tmdbId,
            type: "movie",
            title: movie.title,
            sortTitle: sortTitleFromName(movie.title),
            year: movie.year || null,
            status: movie.hasFile ? "downloaded" : "wanted",
            posterUrl: poster,
            overview: movie.overview || null,
            digitalReleaseDate,
            ...(movie.added ? { addedAt: new Date(movie.added) } : {}),
            ...(defaultQualityProfileId != null
              ? { qualityProfileId: defaultQualityProfileId }
              : {}),
          },
          update: {
            title: movie.title,
            year: movie.year || null,
            posterUrl: poster,
            status: existing
              ? existing.status === "wanted" || existing.status === "downloaded"
                ? movie.hasFile
                  ? "downloaded"
                  : "wanted"
                : existing.status
              : movie.hasFile
                ? "downloaded"
                : "wanted",
            digitalReleaseDate,
          },
        });

        if (existing) {
          progress.radarr.already_existed++;
          result.radarr!.already_existed++;
        } else {
          progress.radarr.imported++;
          result.radarr!.imported++;
        }

        if (movie.hasFile && movie.movieFile) {
          const mf = movie.movieFile;
          const filePath = remapPath(mf.path ?? "");
          const fileName = filePath.split("/").pop() ?? "";
          const fnData = parseFilenameMetadata(fileName);

          const existingFile = await prisma.mediaFile.findFirst({
            where: { mediaId: mediaRow.id },
            select: {
              id: true,
              resolution: true,
              hdrFormat: true,
              bitDepth: true,
            },
          });

          const mi = filePath ? await scanMediaInfo(filePath) : null;

          if (mi) {
            progress.radarr.files_scanned++;
            result.radarr!.files_scanned++;
            const miData = {
              filePath,
              fileName,
              sizeBytes: mi.sizeBytes,
              durationSecs: mi.durationSecs,
              releaseGroup: mf.releaseGroup ?? mi.releaseGroup,
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
              if (fileQualityScore(miData) >= fileQualityScore(existingFile)) {
                await prisma.mediaFile.update({
                  where: { id: existingFile.id },
                  data: miData,
                });
              }
            } else {
              await prisma.mediaFile.create({
                data: { mediaId: mediaRow.id, ...miData },
              });
            }
          } else {
            const arrMi = mf.mediaInfo ?? {};
            const arrAudioTracks = buildAudioTracksFromArr(
              arrMi,
              fileName,
              mf.languages,
            );
            const arrData = {
              filePath,
              fileName,
              sizeBytes: BigInt(mf.size ?? 0),
              releaseGroup: mf.releaseGroup ?? null,
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
              if (fileQualityScore(arrData) >= fileQualityScore(existingFile)) {
                await prisma.mediaFile.update({
                  where: { id: existingFile.id },
                  data: arrData,
                });
              }
            } else {
              await prisma.mediaFile.create({
                data: { mediaId: mediaRow.id, ...arrData },
              });
            }
          }
        }
      } catch (err) {
        progress.radarr.errors++;
        result.radarr!.errors.push(
          `Movie ${movie.title}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  } catch (err) {
    result.radarr!.errors.push(
      `Radarr import failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
