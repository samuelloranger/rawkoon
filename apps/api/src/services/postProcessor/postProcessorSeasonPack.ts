import { basename, extname, join } from "node:path";
import type { PostProcessFailure } from "@rawkoon/api/services/postProcessor/postProcessFailure";
import { stat, rm } from "node:fs/promises";

import { prisma } from "@rawkoon/api/db";
import { remapPath } from "@rawkoon/api/utils/medias/mediainfoScanner";
import { listVideoFilesUnder } from "@rawkoon/api/utils/medias/fileIdentifier";
import {
  renderEpisodeTemplate,
  sanitizePathTemplateOutput,
} from "@rawkoon/api/utils/medias/fileTemplate";
import type { DownloadClientAdapter } from "@rawkoon/api/services/downloadClient/types";
import { loadImportSeedRules } from "@rawkoon/api/services/seeding/importSeedRule";
import {
  afterImportAction,
  applyAfterImportAction,
} from "@rawkoon/api/services/downloadClient/afterImport";
import { resolveDownloadedStatus } from "@rawkoon/api/utils/medias/libraryHelpers";

import {
  parseSeasonEpisode,
  placeImportFile,
  qualityStringsFromParsed,
  resolveTorrentContentPath,
  isFullyReadable,
} from "@rawkoon/api/services/postProcessor/postProcessorHelpers";
import {
  mapSeasonPack,
  parsePartMarker,
  splitUnknownSeasons,
} from "@rawkoon/api/services/library/seasonPackMapping";
import {
  preflightMerges,
  upsertPackMediaFile,
} from "@rawkoon/api/services/postProcessor/postProcessorSeasonPackFile";
import { mkvAppend } from "@rawkoon/api/utils/medias/mkvMerge";

/**
 * Post-process a season pack / intégrale: find all video files under the torrent
 * folder, match each to a LibraryEpisode by SxxExx, hardlink/move to library.
 */
/**
 * Why an episode can't be placed at its library path, or null. A template
 * without the episode number sends several episodes to one path, and a file
 * the library records for another episode is never replaced or adopted.
 */
export function packPathConflict(input: {
  sharedInPack: boolean;
  ownerEpisodeId: number | null;
  episodeId: number;
}): string | null {
  if (input.sharedInPack) {
    return "another episode in this pack renders to the same library path; check the episode naming template";
  }
  if (
    input.ownerEpisodeId != null &&
    input.ownerEpisodeId !== input.episodeId
  ) {
    return "its library path already holds another episode's file";
  }
  return null;
}

export async function postProcessSeasonPack(
  downloadHistoryId: number,
  dh: {
    id: number;
    media: {
      id: number;
      type: string;
      title: string;
      year: number | null;
      tmdbStatus: string | null;
    };
    episode: null;
    season: number | null;
    torrentHash: string | null;
    indexer: string | null;
    releaseTitle: string;
    qualityParsed: unknown;
    isUpgrade?: boolean;
  },
  settings: {
    showsLibraryPath: string | null;
    episodeTemplate: string | null;
    fileOperation: string | null;
    seedSweepEnabled: boolean;
  },
  op: "hardlink" | "move",
  adapter: DownloadClientAdapter,
): Promise<
  | { success: true; destinationPath: string; episodeCount: number }
  | {
      success: true;
      destinationPath: string;
      skipped: true;
      skipReason: string;
    }
  | PostProcessFailure
> {
  const hash = dh.torrentHash?.trim();
  if (!hash) return { success: false, reason: "Torrent hash unknown" };
  const tor = await adapter.getTorrent(hash);
  if (!tor)
    return { success: false, reason: "Torrent not found in download client" };

  const contentBase = resolveTorrentContentPath(
    tor.contentPath,
    tor.savePath,
    tor.name,
  );
  if (!contentBase)
    return { success: false, reason: "Could not resolve torrent content path" };

  const contentRoot = remapPath(contentBase);
  const allVideos = await listVideoFilesUnder(contentRoot);
  if (allVideos.length === 0) {
    // Only an empty import from a readable tree is the release's fault.
    if (!(await isFullyReadable(contentRoot))) {
      return {
        success: false,
        reason:
          "Download content is missing or unreadable — check path mappings and permissions",
      };
    }
    return {
      success: false,
      reason: "No video files found in torrent folder",
      rejectKind: "no_content",
    };
  }

  const episodes = await prisma.libraryEpisode.findMany({
    where: { mediaId: dh.media.id },
  });

  const root = settings.showsLibraryPath!.replace(/\/+$/, "");
  const q = qualityStringsFromParsed(dh.qualityParsed, dh.releaseTitle);

  // Dedupe source files that resolve to the same episode before mapping them.
  // Multiple sources for one episode share a destinationPath, so processing
  // them concurrently would race the findFirst-then-create below and produce
  // duplicate MediaFile rows. Keep the first source per episode.
  const seenEpisodeKeys = new Set<string>();
  const parsedSources = allVideos.flatMap((srcVideo) => {
    const fileName = basename(srcVideo);
    const se = parseSeasonEpisode(fileName);
    if (!se) {
      console.warn(
        `[postProcess/pack] Could not parse an episode number from "${fileName}", skipping`,
      );
      return [];
    }
    const key = `${se.season ?? "abs"}x${se.episode}`;
    if (seenEpisodeKeys.has(key)) return [];
    seenEpisodeKeys.add(key);
    return [
      {
        path: srcVideo,
        fileName,
        season: se.season,
        episode: se.episode,
        part: parsePartMarker(fileName),
        ext: extname(srcVideo) || ".mkv",
      },
    ];
  });

  // A show-level pack (no season) spans seasons; one the provider doesn't know must not sink the rest.
  const { placeable, skipped: unknownSeasonFiles } =
    dh.season == null
      ? splitUnknownSeasons(parsedSources, episodes)
      : { placeable: parsedSources, skipped: [] as string[] };
  const mapping = mapSeasonPack(placeable, episodes, dh.season);
  const skippedFiles = [
    ...(mapping.ok ? (mapping.skipped ?? []) : []),
    ...unknownSeasonFiles,
  ];

  /**
   * Abandon the whole pack, keeping its data: a refusal is often our numbering
   * being wrong, and the files are what a manual import needs. It is
   * blocklisted, or auto-search finds the same pack again and loops.
   */
  const refusePack = async (reason: string): Promise<PostProcessFailure> => {
    await prisma.downloadHistory.update({
      where: { id: downloadHistoryId },
      data: { postProcessError: reason },
    });
    await prisma.grabBlocklist.create({
      data: {
        torrentHash: hash,
        releaseTitle: dh.releaseTitle,
        mediaId: dh.media.id,
        kind: "import_rejected",
        reason,
      },
    });
    console.warn(`[postProcess/pack] ${dh.media.title}: ${reason}`);
    return { success: false, reason };
  };

  if (placeable.length === 0 && unknownSeasonFiles.length > 0) {
    return refusePack(
      `None of the seasons in this pack exist in the show — nothing imported. Unmatched: ${unknownSeasonFiles.join(", ")}`,
    );
  }
  if (!mapping.ok) {
    // Import nothing. A partially-correct season is worse than none: the files
    // that "work" get renamed to the wrong episode's title and look fine until
    // someone watches them.
    return refusePack(
      `Season pack numbering does not match the provider — nothing imported. ${
        mapping.reason
      }${
        mapping.unmatched.length > 0
          ? ` Unmatched: ${mapping.unmatched.join(", ")}`
          : ""
      }`,
    );
  }
  // A show-level pack spans seasons the show may already hold; those episodes keep their files unless this is an upgrade.
  const existingFiles =
    dh.season == null && !dh.isUpgrade
      ? await prisma.mediaFile.findMany({
          where: { mediaId: dh.media.id, episodeId: { not: null } },
          select: { episodeId: true, filePath: true },
        })
      : [];
  const withFiles = new Set(existingFiles.map((f) => f.episodeId));
  const placements = mapping.placements.filter(
    (p) => !withFiles.has(p.episode.id),
  );
  if (placements.length === 0) {
    // A harmless duplicate, not a failure: record why, keep the torrent seeding, blocklist nothing.
    await prisma.libraryEpisode.updateMany({
      where: {
        id: { in: mapping.placements.map((p) => p.episode.id) },
        status: { not: "downloaded" },
      },
      data: { status: "downloaded" },
    });
    await prisma.libraryMedia.update({
      where: { id: dh.media.id },
      data: {
        status: resolveDownloadedStatus(dh.media.type, dh.media.tmdbStatus),
      },
    });
    const destinationPath = existingFiles[0]!.filePath;
    await prisma.downloadHistory.update({
      where: { id: downloadHistoryId },
      data: {
        postProcessDestinationPath: destinationPath,
        postProcessError: null,
        postProcessSkipReason: "all-episodes-present",
      },
    });
    return {
      success: true,
      destinationPath,
      skipped: true,
      skipReason: "all-episodes-present",
    };
  }

  if (skippedFiles.length) {
    console.warn(
      `[postProcess/pack] ${dh.media.title}: ${skippedFiles.length} file(s) could not be placed and were not imported: ${skippedFiles.join(", ")}`,
    );
  }

  // Preflight every merge candidate BEFORE placing anything. Checking track
  // compatibility inside the placement loop would surface the failure after
  // sibling episodes are already hardlinked, and since `processed > 0` the
  // run would then clear postProcessError, mark the show downloaded, and
  // possibly remove the torrent — the opposite of all-or-nothing.
  const mergeProblem = await preflightMerges(placements);
  if (mergeProblem) return refusePack(mergeProblem);

  type EpisodeResult =
    | { ok: true; destinationPath: string; placed: boolean }
    | { ok: false; error: string; fatal?: boolean };

  const destinationFor = (placement: (typeof placements)[number]) => {
    const ep = placement.episode;
    const ext = placement.sources[0].ext;
    const epStem =
      renderEpisodeTemplate(settings.episodeTemplate ?? "", {
        show: dh.media.title,
        season: ep.season,
        episode: ep.episode,
        title: ep.title,
        resolution: q.resolution,
        source: q.source,
        ext,
      }) ||
      sanitizePathTemplateOutput(
        `${dh.media.title}/Season ${ep.season}/${dh.media.title} - S${String(ep.season).padStart(2, "0")}E${String(ep.episode).padStart(2, "0")}`,
      );
    return join(root, `${epStem}${ext}`);
  };
  const pathUses = new Map<string, number>();
  for (const placement of placements) {
    const path = destinationFor(placement);
    pathUses.set(path, (pathUses.get(path) ?? 0) + 1);
  }

  const PACK_CONCURRENCY = 6;
  const episodeResults: (EpisodeResult | null)[] = [];
  for (let i = 0; i < placements.length; i += PACK_CONCURRENCY) {
    const chunk = placements.slice(i, i + PACK_CONCURRENCY);
    const chunkResults = await Promise.all(
      chunk.map(async (placement): Promise<EpisodeResult | null> => {
        const ep = placement.episode;
        const primary = placement.sources[0];
        const srcVideo = primary.path;
        const fn = primary.fileName;
        const destinationPath = destinationFor(placement);
        const label = `S${ep.season}E${ep.episode}`;
        const owner = await prisma.mediaFile.findFirst({
          where: { filePath: destinationPath },
          select: { episodeId: true },
        });
        const conflict = packPathConflict({
          sharedInPack: (pathUses.get(destinationPath) ?? 0) > 1,
          ownerEpisodeId: owner?.episodeId ?? null,
          episodeId: ep.id,
        });
        if (conflict) return { ok: false, error: `${label}: ${conflict}` };

        let placed = true;
        if (placement.kind === "merge") {
          // Track compatibility was already verified in the preflight above.
          const [a, b] = placement.sources;
          // The merge renames over its target, so only an upgrade may do that.
          if (
            !dh.isUpgrade &&
            (await stat(destinationPath).catch(() => null))
          ) {
            placed = false;
          } else if (!(await mkvAppend([a.path, b.path], destinationPath))) {
            // Fatal: a season missing its double episode must not be reported
            // as a successful import.
            return {
              ok: false,
              fatal: true,
              error: `S${ep.season}E${ep.episode}: merging "${a.fileName}" + "${b.fileName}" failed`,
            };
          }
          // The merged file is new content, never a hardlink to the source
          // parts. In move mode the parts are consumed; in hardlink mode they
          // stay put so the torrent keeps seeding.
          if (placed && op === "move") {
            await Promise.all(
              [a.path, b.path].map((p) =>
                rm(p).catch((e) =>
                  console.warn(
                    `[postProcess/pack] Could not remove part ${p}:`,
                    e,
                  ),
                ),
              ),
            );
          }
        } else {
          try {
            placed = await placeImportFile(
              srcVideo,
              destinationPath,
              op,
              dh.isUpgrade === true,
            );
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            return { ok: false, error: `S${ep.season}E${ep.episode}: ${msg}` };
          }
        }
        try {
          await upsertPackMediaFile({
            mediaId: dh.media.id,
            episodeId: ep.id,
            destinationPath,
            fileName: fn,
            releaseTitle: dh.releaseTitle,
            fallbackSource: q.source,
          });
        } catch (e) {
          console.warn(
            `[postProcess/pack] MediaFile upsert failed for ${fn}:`,
            e,
          );
        }
        try {
          await prisma.libraryEpisode.update({
            where: { id: ep.id },
            data: { status: "downloaded", downloadedAt: new Date() },
          });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          return {
            ok: false,
            error: `S${ep.season}E${ep.episode}: episode status update failed: ${msg}`,
          };
        }
        return { ok: true, destinationPath, placed };
      }),
    );
    episodeResults.push(...chunkResults);
  }

  let processed = 0;
  const errors: string[] = [];
  const fatalErrors: string[] = [];
  let firstDest: string | null = null;
  let allPlaced = true;
  for (const result of episodeResults) {
    if (result === null) continue;
    if (!result.ok) {
      errors.push(result.error);
      if (result.fatal) fatalErrors.push(result.error);
    } else {
      processed++;
      if (!result.placed) allPlaced = false;
      if (!firstDest) firstDest = result.destinationPath;
    }
  }

  // A failed merge leaves the season without its double episode. Reporting
  // that as a success would clear postProcessError, mark the show downloaded,
  // and let the torrent be removed — losing the only copy of the parts.
  if (fatalErrors.length > 0) {
    return refusePack(
      `Season pack partially imported but a split episode could not be merged — ${fatalErrors.join("; ")}`,
    );
  }

  if (processed === 0) {
    return {
      success: false,
      reason:
        errors.length > 0
          ? errors.join("; ")
          : "No episodes could be matched or placed",
    };
  }

  await prisma.libraryMedia.update({
    where: { id: dh.media.id },
    data: {
      status: resolveDownloadedStatus(dh.media.type, dh.media.tmdbStatus),
    },
  });
  await prisma.downloadHistory.update({
    where: { id: downloadHistoryId },
    data: { postProcessDestinationPath: firstDest, postProcessError: null },
  });

  console.log(
    `[postProcess/pack] Processed ${processed} episodes for "${dh.media.title}" (${errors.length} errors)`,
  );

  await applyAfterImportAction(
    adapter,
    hash,
    afterImportAction({
      type: adapter.type,
      ratio: tor.ratio,
      seedingTimeSecs: tor.seedingTimeSecs,
      rules: await loadImportSeedRules({
        hash,
        indexer: dh.indexer,
        type: adapter.type,
        seedSweepEnabled: settings.seedSweepEnabled,
      }),
      seedSweepEnabled: settings.seedSweepEnabled,
      // Failed episodes, skipped ones and files left out of the mapping still need their data.
      fullyImported:
        errors.length === 0 && allPlaced && skippedFiles.length === 0,
    }),
    "postProcess/pack",
  );

  return {
    success: true,
    destinationPath: firstDest!,
    episodeCount: processed,
  };
}
