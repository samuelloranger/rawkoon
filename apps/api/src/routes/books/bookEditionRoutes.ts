import { Hono } from "hono";
import { z } from "zod";

import type { Env } from "@rawkoon/api/honoEnv";
import { requireAdmin, requireUser } from "@rawkoon/api/middleware/hono/auth";
import { jsonV, paramV } from "@rawkoon/api/middleware/validate";
import { badRequest, notFound, ok } from "@rawkoon/api/errors";
import { loadConfig } from "@rawkoon/api/config";
import type { BookEditionKind } from "@rawkoon/shared/types";
import { signGrant } from "@rawkoon/api/services/books/downloadGrant";

import { rescanBookEdition } from "@rawkoon/api/services/postProcessor/postProcessorBookRescan";

import {
  bookExists,
  createEdition,
  deleteEditionFile,
  EDITION_STATUSES,
  findBookQualityProfile,
  findEditionIdByKind,
  findEditionWithFiles,
  updateEdition,
} from "@rawkoon/api/services/books/bookEditionAdmin";

import { mapBookEdition } from "./bookHelpers";

const EDITION_FILE_GRANT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const editionKindParams = z.object({
  id: z.coerce.number(),
  kind: z.union([z.literal("ebook"), z.literal("audiobook")]),
});

/**
 * Per-edition state. Monitoring is per edition kind, so a user can want the
 * audiobook of a title without wanting its ebook.
 *
 *   PATCH  /api/books/:id/editions/:kind
 *   POST   /api/books/:id/editions
 *   GET    /api/books/:id/editions/:kind/files
 *   DELETE /api/books/:id/files/:fileId
 */
export const bookEditionRoutes = new Hono<Env>()
  .patch(
    "/:id/editions/:kind",
    requireAdmin,
    paramV(editionKindParams),
    jsonV(
      z.object({
        monitored: z.boolean().optional(),
        status: z.string().optional(),
        book_quality_profile_id: z.coerce.number().nullable().optional(),
      }),
    ),
    async (c) => {
      const params = c.req.valid("param");
      const body = c.req.valid("json");
      const edition = await findEditionIdByKind(params.id, params.kind);
      if (!edition) return notFound("Edition not found");

      if (body.status && !EDITION_STATUSES.includes(body.status)) {
        return badRequest(
          `status must be one of ${EDITION_STATUSES.join(", ")}`,
        );
      }

      if (body.book_quality_profile_id != null) {
        const profile = await findBookQualityProfile(
          body.book_quality_profile_id,
        );
        if (!profile) return notFound("Book quality profile not found");
        // A profile scoped to one kind must not be attached to the other.
        if (profile.kind !== "both" && profile.kind !== params.kind) {
          return badRequest(
            `Profile "${profile.id}" is for ${profile.kind} editions, not ${params.kind}`,
          );
        }
      }

      const updated = await updateEdition(edition.id, {
        monitored: body.monitored,
        status: body.status,
        bookQualityProfileId: body.book_quality_profile_id,
      });

      return ok({ edition: mapBookEdition(updated) });
    },
  )

  // Add the other edition kind to a book that only has one.
  .post(
    "/:id/editions",
    requireAdmin,
    paramV(z.object({ id: z.coerce.number() })),
    jsonV(
      z.object({
        kind: z.union([z.literal("ebook"), z.literal("audiobook")]),
        monitored: z.boolean().optional(),
        book_quality_profile_id: z.coerce.number().nullable().optional(),
      }),
    ),
    async (c) => {
      const params = c.req.valid("param");
      const body = c.req.valid("json");
      const book = await bookExists(params.id);
      if (!book) return notFound("Book not found");

      const kind = body.kind as BookEditionKind;
      const existing = await findEditionIdByKind(params.id, kind);
      if (existing) {
        return badRequest(`This book already has an ${kind} edition`);
      }

      const created = await createEdition(params.id, kind, {
        monitored: body.monitored,
        bookQualityProfileId: body.book_quality_profile_id,
      });

      return ok({ edition: mapBookEdition(created) });
    },
  )

  .get(
    "/:id/editions/:kind/files",
    requireUser,
    paramV(editionKindParams),
    async (c) => {
      const params = c.req.valid("param");
      const edition = await findEditionWithFiles(params.id, params.kind);
      if (!edition) return notFound("Edition not found");
      const secret = loadConfig().SECRET_KEY;
      const expiresAt = Date.now() + EDITION_FILE_GRANT_TTL_MS;

      return ok({
        edition_id: edition.id,
        kind: edition.kind,
        files: edition.files.map((f) => ({
          id: f.id,
          file_name: f.fileName,
          file_path: f.filePath,
          content_url: `/api/books/files/${f.id}/content?grant=${signGrant(
            {
              fileId: f.id,
              variant: "original",
              grantId: crypto.randomUUID(),
              expiresAt,
            },
            secret,
          )}`,
          size_bytes: f.sizeBytes.toString(),
          format: f.format,
          duration_secs: f.durationSecs,
          audio_bitrate: f.audioBitrate,
          audio_codec: f.audioCodec,
          is_retail: f.isRetail,
          release_group: f.releaseGroup,
          language_tags: f.languageTags,
          scanned_at: f.scannedAt.toISOString(),
        })),
      });
    },
  )

  /**
   * Register files already in the library for this edition.
   *
   * Removing a book keeps its files on disk, so re-adding it leaves an edition
   * that reads "wanted" while the file sits right there. This adopts them.
   */
  .post(
    "/:id/editions/:kind/rescan",
    requireAdmin,
    paramV(editionKindParams),
    async (c) => {
      const params = c.req.valid("param");
      const edition = await findEditionIdByKind(params.id, params.kind);
      if (!edition) return notFound("Edition not found");

      const result = await rescanBookEdition(edition.id);
      if (result.error) return badRequest(result.error);
      return ok({
        registered: result.registered,
        refreshed: result.refreshed,
        removed: result.removed,
        directory: result.directory,
      });
    },
  )

  // Removes the DB row only; the file on disk is left alone, matching how
  // library media file removal behaves.
  .delete(
    "/:id/files/:fileId",
    requireAdmin,
    paramV(z.object({ id: z.coerce.number(), fileId: z.coerce.number() })),
    async (c) => {
      const params = c.req.valid("param");
      const deleted = await deleteEditionFile(params.id, params.fileId);
      if (!deleted) return notFound("File not found");
      return ok({ deleted: true });
    },
  );
