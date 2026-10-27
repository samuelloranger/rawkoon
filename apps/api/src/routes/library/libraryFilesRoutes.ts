import { Hono } from "hono";
import { seedStateForRow } from "@rawkoon/api/services/seeding/seedingView";
import { z } from "zod";

import { badRequest, notFound, ok, serverError } from "@rawkoon/api/errors";
import type { Env } from "@rawkoon/api/honoEnv";
import { ensureAdmin, requireUser } from "@rawkoon/api/middleware/hono/auth";
import { jsonV, queryV } from "@rawkoon/api/middleware/validate";
import { enqueuePostProcess } from "@rawkoon/api/services/downloads/downloadOutcome";
import {
  checkPostProcessRetryable,
  clearFailedDownloads,
  deleteEpisodeFiles,
  deleteMediaFile,
  getDownloadHistoryWithLive,
  listEpisodesForMedia,
  listMediaFiles,
  performDownloadAction,
  removeDownloadHistoryEntry,
  updateMediaFileReleaseGroup,
} from "@rawkoon/api/services/library/libraryFiles";
import { rescanLibraryItem } from "@rawkoon/api/services/library/rescan";

const deleteFileQuery = z.object({ delete_file: z.string().optional() });

/**
 * File-level operations: list, rescan, delete file, delete episode files.
 * All routes are requireUser; the mutating ones add an inline ensureAdmin.
 */
export const libraryFilesRoutes = new Hono<Env>()
  .get("/:id/episodes", requireUser, async (c) => {
    try {
      const id = parseInt(c.req.param("id"), 10);
      const episodes = await listEpisodesForMedia(id);
      if (!episodes) return notFound("Library item not found");

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
      const history = await getDownloadHistoryWithLive(id);
      if (!history) return notFound("Library item not found");
      const { items, torrentByHash, liveByHash } = history;

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
          seed: seedStateForRow(
            h,
            h.torrentHash
              ? torrentByHash.get(h.torrentHash.toLowerCase())
              : undefined,
          ),
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

      const deleted = await clearFailedDownloads(mediaId);
      if (deleted === null) return notFound("Library item not found");
      return ok({ deleted });
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

      const result = await removeDownloadHistoryEntry(mediaId, dhId);
      if (result === "not_found") return notFound("Download history not found");
      if (result === "not_removable") {
        return badRequest(
          "Only failed downloads or post-processing errors can be removed",
        );
      }
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

        const result = await performDownloadAction(
          mediaId,
          dhId,
          body.action,
          body.delete_files ?? false,
        );
        if (result === "not_found") {
          return notFound("Download history not found");
        }
        if (result === "no_torrent") {
          return badRequest("Download has no torrent to control");
        }
        if (result === "no_client") {
          return badRequest("Download client is not configured");
        }
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

      const check = await checkPostProcessRetryable(dhId);
      if (check === "not_found") return notFound("Download history not found");
      if (check === "failed") return badRequest("Download is marked as failed");
      if (check === "not_completed") {
        return badRequest("Download not yet completed");
      }

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
      const result = await listMediaFiles(id);
      if (!result) return notFound("Library item not found");

      return ok({
        media_type: result.mediaType,
        files: result.files.map((f) => ({
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

        const updated = await updateMediaFileReleaseGroup(
          fileId,
          body.release_group,
        );
        if (!updated) return notFound("File not found");

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

      const found = await deleteMediaFile(
        fileId,
        c.req.valid("query").delete_file === "true",
      );
      if (!found) return notFound("File not found");

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

        const found = await deleteEpisodeFiles(
          mediaId,
          episodeId,
          c.req.valid("query").delete_file === "true",
        );
        if (!found) return notFound("Episode not found");

        return ok({ success: true });
      } catch {
        return serverError("Failed to delete episode");
      }
    },
  );
