import { Hono } from "hono";
import { z } from "zod";

import { prisma } from "@rawkoon/api/db";
import { badRequest, notFound, ok, serverError } from "@rawkoon/api/errors";
import type { Env } from "@rawkoon/api/honoEnv";
import { ensureAdmin, requireUser } from "@rawkoon/api/middleware/hono/auth";
import { jsonV, queryV } from "@rawkoon/api/middleware/validate";
import {
  enqueuePostProcess,
  revertToWantedIfNoActiveGrabs,
} from "@rawkoon/api/services/downloadOutcome";
import { rescanLibraryItem } from "@rawkoon/api/services/library/rescan";

/** Newest grabs shown in the library detail history panel. */
const MEDIA_HISTORY_LIMIT = 200;

const deleteFileQuery = z.object({ delete_file: z.string().optional() });

/**
 * File-level operations: list, rescan, delete file, delete episode files.
 * All routes are requireUser; the mutating ones add an inline ensureAdmin.
 */
export const libraryFilesRoutes = new Hono<Env>()
  .get("/:id/episodes", requireUser, async (c) => {
    try {
      const id = parseInt(c.req.param("id"), 10);
      const media = await prisma.libraryMedia.findUnique({ where: { id } });
      if (!media) return notFound("Library item not found");

      const episodes = await prisma.libraryEpisode.findMany({
        where: { mediaId: id },
        orderBy: [{ season: "asc" }, { episode: "asc" }],
      });

      const bySeason = new Map<number, typeof episodes>();
      for (const ep of episodes) {
        if (!bySeason.has(ep.season)) bySeason.set(ep.season, []);
        bySeason.get(ep.season)!.push(ep);
      }

      return ok({
        seasons: Array.from(bySeason.entries()).map(([seasonNumber, eps]) => ({
          season: seasonNumber,
          episodes: eps.map((ep) => ({
            id: ep.id,
            season: ep.season,
            episode: ep.episode,
            title: ep.title,
            air_date: ep.airDate?.toISOString().slice(0, 10) ?? null,
            status: ep.status,
            monitored: ep.monitored,
            tmdb_episode_id: ep.tmdbEpisodeId,
            downloaded_at: ep.downloadedAt?.toISOString() ?? null,
            search_attempts: ep.searchAttempts,
          })),
        })),
      });
    } catch {
      return serverError("Failed to fetch episodes");
    }
  })

  .get("/:id/downloads", requireUser, async (c) => {
    try {
      const id = parseInt(c.req.param("id"), 10);
      const media = await prisma.libraryMedia.findUnique({ where: { id } });
      if (!media) return notFound("Library item not found");

      const items = await prisma.downloadHistory.findMany({
        where: { mediaId: id },
        orderBy: { grabbedAt: "desc" },
        // Newest-first cap: a long-running upgrade loop can accumulate hundreds
        // of grabs for one title, and the detail panel only renders recent ones.
        take: MEDIA_HISTORY_LIMIT,
      });

      // Best-effort live progress for rows still downloading.
      const activeHashes = items
        .filter((h) => !h.completedAt && !h.failed && h.torrentHash)
        .map((h) => h.torrentHash as string);

      const liveByHash = new Map<
        string,
        {
          progress: number;
          download_speed: number;
          eta_seconds: number | null;
          state: string;
        }
      >();
      if (activeHashes.length > 0) {
        const { resolveActiveAdapter } = await import(
          "@rawkoon/api/services/downloadClient/registry"
        );
        const active = await resolveActiveAdapter();
        if (active) {
          try {
            const torrents = await active.adapter.listTorrents();
            const wanted = new Set(
              activeHashes.map((hash) => hash.toLowerCase()),
            );
            for (const torrent of torrents) {
              if (!wanted.has(torrent.hash.toLowerCase())) continue;
              liveByHash.set(torrent.hash.toLowerCase(), {
                progress: torrent.progress,
                download_speed: torrent.dlSpeed,
                eta_seconds: null,
                state: torrent.state,
              });
            }
          } catch {
            // Client unavailable: keep live progress null.
          }
        }
      }

      return ok({
        items: items.map((h) => ({
          id: h.id,
          release_title: h.releaseTitle,
          indexer: h.indexer,
          torrent_hash: h.torrentHash,
          grabbed_at: h.grabbedAt.toISOString(),
          completed_at: h.completedAt?.toISOString() ?? null,
          failed: h.failed,
          fail_reason: h.failReason,
          episode_id: h.episodeId,
          post_process_error: h.postProcessError,
          post_process_destination_path: h.postProcessDestinationPath,
          ai_picked: h.aiPicked,
          // Only active rows are in liveByHash; completed/failed rows resolve to null.
          live:
            h.torrentHash != null
              ? (liveByHash.get(h.torrentHash.toLowerCase()) ?? null)
              : null,
        })),
      });
    } catch {
      return serverError("Failed to fetch download history");
    }
  })

  .delete("/:id/downloads/failed", requireUser, async (c) => {
    const denied = ensureAdmin(c.get("user"));
    if (denied) return denied;
    try {
      const mediaId = parseInt(c.req.param("id"), 10);
      if (!Number.isFinite(mediaId)) return badRequest("Invalid id");

      const media = await prisma.libraryMedia.findUnique({
        where: { id: mediaId },
      });
      if (!media) return notFound("Library item not found");

      const staleRows = await prisma.downloadHistory.findMany({
        where: {
          mediaId,
          OR: [
            { failed: true },
            {
              AND: [
                { postProcessError: { not: null } },
                { postProcessError: { not: "" } },
              ],
            },
          ],
        },
        select: { id: true },
      });
      const ids = staleRows.map((r) => r.id);
      if (ids.length === 0) return ok({ deleted: 0 });

      const { emitLibraryUpdate } = await import(
        "@rawkoon/api/services/libraryEvents"
      );

      await prisma.$transaction([
        prisma.libraryAttentionAlert.updateMany({
          where: {
            status: "open",
            downloadHistoryId: { in: ids },
          },
          data: {
            status: "resolved_auto",
            resolvedAt: new Date(),
          },
        }),
        prisma.downloadHistory.deleteMany({
          where: { id: { in: ids } },
        }),
      ]);

      emitLibraryUpdate(mediaId);
      return ok({ deleted: ids.length });
    } catch (err) {
      console.error("Library clear failed downloads error:", err);
      return serverError("Failed to delete download history");
    }
  })

  .delete("/:id/downloads/:dhId", requireUser, async (c) => {
    const denied = ensureAdmin(c.get("user"));
    if (denied) return denied;
    try {
      const mediaId = parseInt(c.req.param("id"), 10);
      const dhId = parseInt(c.req.param("dhId"), 10);
      if (!Number.isFinite(mediaId) || !Number.isFinite(dhId)) {
        return badRequest("Invalid id");
      }

      const { isRemovableDownloadHistoryEntry } = await import(
        "@rawkoon/shared"
      );

      const dh = await prisma.downloadHistory.findFirst({
        where: { id: dhId, mediaId },
        select: {
          id: true,
          failed: true,
          postProcessError: true,
        },
      });
      if (!dh) return notFound("Download history not found");
      if (!isRemovableDownloadHistoryEntry(dh)) {
        return badRequest(
          "Only failed downloads or post-processing errors can be removed",
        );
      }

      const { emitLibraryUpdate } = await import(
        "@rawkoon/api/services/libraryEvents"
      );

      await prisma.$transaction([
        prisma.libraryAttentionAlert.updateMany({
          where: {
            status: "open",
            downloadHistoryId: dhId,
          },
          data: {
            status: "resolved_auto",
            resolvedAt: new Date(),
          },
        }),
        prisma.downloadHistory.delete({ where: { id: dhId } }),
      ]);

      emitLibraryUpdate(mediaId);
      return ok({ success: true });
    } catch (err) {
      console.error("Library delete download entry error:", err);
      return serverError("Failed to delete download history");
    }
  })

  .post(
    "/:id/downloads/:dhId/action",
    requireUser,
    jsonV(
      z.object({
        action: z.union([
          z.literal("pause"),
          z.literal("resume"),
          z.literal("remove"),
        ]),
        delete_files: z.boolean().optional(),
      }),
    ),
    async (c) => {
      const denied = ensureAdmin(c.get("user"));
      if (denied) return denied;
      try {
        const mediaId = parseInt(c.req.param("id"), 10);
        const dhId = parseInt(c.req.param("dhId"), 10);
        if (!Number.isFinite(mediaId) || !Number.isFinite(dhId)) {
          return badRequest("Invalid id");
        }
        const body = c.req.valid("json");

        const dh = await prisma.downloadHistory.findFirst({
          where: { id: dhId, mediaId },
          select: {
            id: true,
            mediaId: true,
            torrentHash: true,
            episodeId: true,
          },
        });
        if (!dh) return notFound("Download history not found");

        const { resolveActiveAdapter } = await import(
          "@rawkoon/api/services/downloadClient/registry"
        );
        const { emitLibraryUpdate } = await import(
          "@rawkoon/api/services/libraryEvents"
        );

        if (body.action === "remove") {
          if (dh.torrentHash) {
            const active = await resolveActiveAdapter();
            if (active) {
              // Best-effort: a missing torrent shouldn't block removing the row.
              await active.adapter
                .remove(dh.torrentHash, body.delete_files ?? false)
                .catch(() => {});
            }
          }
          await revertToWantedIfNoActiveGrabs({
            id: dh.id,
            mediaId: dh.mediaId,
            episodeId: dh.episodeId,
          });
          await prisma.$transaction([
            prisma.libraryAttentionAlert.updateMany({
              where: { status: "open", downloadHistoryId: dhId },
              data: { status: "resolved_auto", resolvedAt: new Date() },
            }),
            prisma.downloadHistory.delete({ where: { id: dhId } }),
          ]);
          emitLibraryUpdate(mediaId);
          return ok({ success: true });
        }

        // pause / resume — require a torrent hash
        if (!dh.torrentHash) {
          return badRequest("Download has no torrent to control");
        }
        const active = await resolveActiveAdapter();
        if (!active) {
          return badRequest("Download client is not configured");
        }
        if (body.action === "pause") await active.adapter.pause(dh.torrentHash);
        else await active.adapter.resume(dh.torrentHash);
        emitLibraryUpdate(mediaId);
        return ok({ success: true });
      } catch (err) {
        console.error("Library download action error:", err);
        return serverError("Failed to perform download action");
      }
    },
  )

  .post("/downloads/:dhId/retry-post-process", requireUser, async (c) => {
    const denied = ensureAdmin(c.get("user"));
    if (denied) return denied;
    try {
      const dhId = parseInt(c.req.param("dhId"), 10);
      if (isNaN(dhId)) return badRequest("Invalid download history id");

      const dh = await prisma.downloadHistory.findUnique({
        where: { id: dhId },
        select: { id: true, completedAt: true, failed: true },
      });
      if (!dh) return notFound("Download history not found");
      if (dh.failed) return badRequest("Download is marked as failed");
      if (!dh.completedAt) return badRequest("Download not yet completed");

      // force: an operator retry must run even when a completed job for this
      // row is still retained by the queue.
      const queued = await enqueuePostProcess(dhId, { force: true });
      if (!queued) {
        return badRequest("Post-processing is disabled");
      }
      return ok({ queued: true, download_history_id: dhId });
    } catch {
      return serverError("Failed to queue post-processing");
    }
  })

  .get("/:id/files", requireUser, async (c) => {
    try {
      const id = parseInt(c.req.param("id"), 10);
      const media = await prisma.libraryMedia.findUnique({ where: { id } });
      if (!media) return notFound("Library item not found");

      const files = await prisma.mediaFile.findMany({
        where: { mediaId: id },
        include: {
          episode: { select: { season: true, episode: true, title: true } },
        },
      });

      // Sort: episodes by season → episode number; non-episode files by filename
      files.sort((a, b) => {
        const ae = a.episode,
          be = b.episode;
        if (ae && be) {
          if (ae.season !== be.season) return ae.season - be.season;
          return ae.episode - be.episode;
        }
        if (ae) return 1;
        if (be) return -1;
        return a.fileName.localeCompare(b.fileName);
      });

      return ok({
        media_type: media.type,
        files: files.map((f) => ({
          id: f.id,
          file_name: f.fileName,
          file_path: f.filePath,
          size_bytes: f.sizeBytes.toString(),
          duration_secs: f.durationSecs,
          release_group: f.releaseGroup,
          video_codec: f.videoCodec,
          video_profile: f.videoProfile,
          width: f.width,
          height: f.height,
          frame_rate: f.frameRate,
          bit_depth: f.bitDepth,
          video_bitrate: f.videoBitrate,
          hdr_format: f.hdrFormat,
          resolution: f.resolution,
          source: f.source,
          audio_tracks: f.audioTracks,
          subtitle_tracks: f.subtitleTracks,
          scanned_at: f.scannedAt.toISOString(),
          season: f.episode?.season ?? null,
          episode: f.episode?.episode ?? null,
          episode_title: f.episode?.title ?? null,
        })),
      });
    } catch {
      return serverError("Failed to fetch file info");
    }
  })

  .post("/:id/rescan", requireUser, async (c) => {
    const denied = ensureAdmin(c.get("user"));
    if (denied) return denied;
    try {
      const id = parseInt(c.req.param("id"), 10);
      const result = await rescanLibraryItem(id);
      if (!result) return notFound("Library item not found");
      return ok({
        rescanned: result.rescanned,
        skipped: result.skipped,
        failed: result.failed,
        deleted: result.deleted,
        imported: result.imported,
        requeued: result.requeued,
      });
    } catch {
      return serverError("Failed to rescan files");
    }
  })

  .patch(
    "/files/:fileId",
    requireUser,
    jsonV(
      z.object({
        release_group: z.union([z.string(), z.null()]).optional(),
      }),
    ),
    async (c) => {
      const denied = ensureAdmin(c.get("user"));
      if (denied) return denied;
      try {
        const fileId = parseInt(c.req.param("fileId"), 10);
        if (!Number.isFinite(fileId)) return badRequest("Invalid file id");
        const body = c.req.valid("json");

        const file = await prisma.mediaFile.findUnique({
          where: { id: fileId },
        });
        if (!file) return notFound("File not found");

        const updated = await prisma.mediaFile.update({
          where: { id: fileId },
          data: {
            ...(body.release_group !== undefined
              ? { releaseGroup: body.release_group }
              : {}),
          },
        });

        return ok({ id: updated.id, release_group: updated.releaseGroup });
      } catch {
        return serverError("Failed to update file");
      }
    },
  )

  // DELETE /api/library/files/:fileId — remove a single MediaFile record
  // ?delete_file=true also removes the physical file from disk
  .delete("/files/:fileId", requireUser, queryV(deleteFileQuery), async (c) => {
    const denied = ensureAdmin(c.get("user"));
    if (denied) return denied;
    try {
      const fileId = parseInt(c.req.param("fileId"), 10);
      if (!Number.isFinite(fileId)) return badRequest("Invalid file id");

      const file = await prisma.mediaFile.findUnique({
        where: { id: fileId },
      });
      if (!file) return notFound("File not found");

      // Delete the DB row first: a stale row pointing at a deleted file is
      // worse than a leftover file on disk. If the fs removal below fails we
      // only log it.
      await prisma.mediaFile.delete({ where: { id: fileId } });

      if (c.req.valid("query").delete_file === "true") {
        const { rm } = await import("node:fs/promises");
        try {
          await rm(file.filePath);
        } catch (e) {
          // File may already be gone, or removal failed after the row was
          // deleted — log and move on rather than resurrecting the row.
          console.warn(
            `[library/files] Failed to remove ${file.filePath} after deleting MediaFile ${fileId}:`,
            e,
          );
        }
      }

      // If the parent media item now has no files left, reset it to "wanted"
      if (file.mediaId !== null) {
        const remaining = await prisma.mediaFile.count({
          where: { mediaId: file.mediaId },
        });
        if (remaining === 0) {
          await prisma.libraryMedia.updateMany({
            where: {
              id: file.mediaId,
              status: { notIn: ["wanted", "skipped"] },
            },
            data: { status: "wanted", searchAttempts: 0 },
          });
        }
      }

      return ok({ success: true });
    } catch {
      return serverError("Failed to delete file");
    }
  })

  // DELETE /api/library/:id/episodes/:episodeId — remove all files for an episode
  // and reset it to "wanted". ?delete_file=true also removes files from disk.
  .delete(
    "/:id/episodes/:episodeId",
    requireUser,
    queryV(deleteFileQuery),
    async (c) => {
      const denied = ensureAdmin(c.get("user"));
      if (denied) return denied;
      try {
        const mediaId = parseInt(c.req.param("id"), 10);
        const episodeId = parseInt(c.req.param("episodeId"), 10);
        if (!Number.isFinite(mediaId) || !Number.isFinite(episodeId)) {
          return badRequest("Invalid id");
        }

        const ep = await prisma.libraryEpisode.findFirst({
          where: { id: episodeId, mediaId },
          include: { files: true },
        });
        if (!ep) return notFound("Episode not found");

        if (
          c.req.valid("query").delete_file === "true" &&
          ep.files.length > 0
        ) {
          const { rm } = await import("node:fs/promises");
          for (const f of ep.files) {
            try {
              await rm(f.filePath);
            } catch {
              // ignore — file may already be gone
            }
          }
        }

        if (ep.files.length > 0) {
          await prisma.mediaFile.deleteMany({ where: { episodeId } });
        }

        await prisma.libraryEpisode.update({
          where: { id: episodeId },
          data: { status: "wanted", searchAttempts: 0, downloadedAt: null },
        });

        const remainingFiles = await prisma.mediaFile.count({
          where: { mediaId },
        });
        if (remainingFiles === 0) {
          await prisma.libraryMedia.updateMany({
            where: {
              id: mediaId,
              status: { notIn: ["wanted", "skipped"] },
            },
            data: { status: "wanted", searchAttempts: 0 },
          });
        }

        return ok({ success: true });
      } catch {
        return serverError("Failed to delete episode");
      }
    },
  );
