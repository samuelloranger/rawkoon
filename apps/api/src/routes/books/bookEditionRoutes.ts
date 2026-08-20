import { Elysia, t } from "elysia";

import { requireUser } from "@rawkoon/api/middleware/auth";
import { prisma } from "@rawkoon/api/db";
import { badRequest, notFound } from "@rawkoon/api/errors";
import type { BookEditionKind } from "@rawkoon/shared/types";

import { mapBookEdition } from "./bookHelpers";

const EDITION_STATUSES = [
  "wanted",
  "downloading",
  "downloaded",
  "skipped",
  "upgrading",
];

const editionSelect = {
  id: true,
  kind: true,
  status: true,
  monitored: true,
  bookQualityProfileId: true,
  bookQualityProfile: { select: { id: true, name: true } },
  narrators: true,
  durationSecs: true,
  searchAttempts: true,
  lastGrabbedAt: true,
  totalSizeBytes: true,
  files: { select: { id: true, format: true } },
} as const;

/**
 * Per-edition state. Monitoring is per edition kind, so a user can want the
 * audiobook of a title without wanting its ebook.
 *
 *   PATCH  /api/books/:id/editions/:kind
 *   POST   /api/books/:id/editions
 *   GET    /api/books/:id/editions/:kind/files
 *   DELETE /api/books/:id/files/:fileId
 */
export const bookEditionRoutes = new Elysia()
  .use(requireUser)

  .patch(
    "/:id/editions/:kind",
    async ({ params, body, set }) => {
      const edition = await prisma.bookEdition.findUnique({
        where: { bookId_kind: { bookId: params.id, kind: params.kind } },
        select: { id: true },
      });
      if (!edition) return notFound(set, "Edition not found");

      if (body.status && !EDITION_STATUSES.includes(body.status)) {
        return badRequest(
          set,
          `status must be one of ${EDITION_STATUSES.join(", ")}`,
        );
      }

      if (body.book_quality_profile_id != null) {
        const profile = await prisma.bookQualityProfile.findUnique({
          where: { id: body.book_quality_profile_id },
          select: { id: true, kind: true },
        });
        if (!profile) return notFound(set, "Book quality profile not found");
        // A profile scoped to one kind must not be attached to the other.
        if (profile.kind !== "both" && profile.kind !== params.kind) {
          return badRequest(
            set,
            `Profile "${profile.id}" is for ${profile.kind} editions, not ${params.kind}`,
          );
        }
      }

      const updated = await prisma.bookEdition.update({
        where: { id: edition.id },
        data: {
          ...(body.monitored !== undefined
            ? { monitored: body.monitored }
            : {}),
          ...(body.status !== undefined ? { status: body.status } : {}),
          ...(body.book_quality_profile_id !== undefined
            ? { bookQualityProfileId: body.book_quality_profile_id }
            : {}),
        },
        select: editionSelect,
      });

      return { edition: mapBookEdition(updated) };
    },
    {
      params: t.Object({
        id: t.Numeric(),
        kind: t.Union([t.Literal("ebook"), t.Literal("audiobook")]),
      }),
      body: t.Object({
        monitored: t.Optional(t.Boolean()),
        status: t.Optional(t.String()),
        book_quality_profile_id: t.Optional(t.Nullable(t.Numeric())),
      }),
    },
  )

  // Add the other edition kind to a book that only has one.
  .post(
    "/:id/editions",
    async ({ params, body, set }) => {
      const book = await prisma.libraryBook.findUnique({
        where: { id: params.id },
        select: { id: true },
      });
      if (!book) return notFound(set, "Book not found");

      const kind = body.kind as BookEditionKind;
      const existing = await prisma.bookEdition.findUnique({
        where: { bookId_kind: { bookId: params.id, kind } },
        select: { id: true },
      });
      if (existing) {
        return badRequest(set, `This book already has an ${kind} edition`);
      }

      const profile =
        body.book_quality_profile_id ??
        (
          await prisma.bookQualityProfile.findFirst({
            where: { OR: [{ kind }, { kind: "both" }] },
            select: { id: true },
            orderBy: { kind: "asc" },
          })
        )?.id ??
        null;

      const created = await prisma.bookEdition.create({
        data: {
          bookId: params.id,
          kind,
          monitored: body.monitored ?? true,
          bookQualityProfileId: profile,
        },
        select: editionSelect,
      });

      return { edition: mapBookEdition(created) };
    },
    {
      params: t.Object({ id: t.Numeric() }),
      body: t.Object({
        kind: t.Union([t.Literal("ebook"), t.Literal("audiobook")]),
        monitored: t.Optional(t.Boolean()),
        book_quality_profile_id: t.Optional(t.Nullable(t.Numeric())),
      }),
    },
  )

  .get(
    "/:id/editions/:kind/files",
    async ({ params, set }) => {
      const edition = await prisma.bookEdition.findUnique({
        where: { bookId_kind: { bookId: params.id, kind: params.kind } },
        include: { files: { orderBy: { fileName: "asc" } } },
      });
      if (!edition) return notFound(set, "Edition not found");

      return {
        edition_id: edition.id,
        kind: edition.kind,
        files: edition.files.map((f) => ({
          id: f.id,
          file_name: f.fileName,
          file_path: f.filePath,
          size_bytes: f.sizeBytes.toString(),
          format: f.format,
          duration_secs: f.durationSecs,
          audio_bitrate: f.audioBitrate,
          audio_codec: f.audioCodec,
          chapter_count: f.chapterCount,
          is_retail: f.isRetail,
          release_group: f.releaseGroup,
          language_tags: f.languageTags,
          scanned_at: f.scannedAt.toISOString(),
        })),
      };
    },
    {
      params: t.Object({
        id: t.Numeric(),
        kind: t.Union([t.Literal("ebook"), t.Literal("audiobook")]),
      }),
    },
  )

  // Removes the DB row only; the file on disk is left alone, matching how
  // library media file removal behaves.
  .delete(
    "/:id/files/:fileId",
    async ({ params, set }) => {
      const file = await prisma.bookFile.findFirst({
        where: { id: params.fileId, edition: { bookId: params.id } },
        select: { id: true },
      });
      if (!file) return notFound(set, "File not found");
      await prisma.bookFile.delete({ where: { id: file.id } });
      return { deleted: true };
    },
    { params: t.Object({ id: t.Numeric(), fileId: t.Numeric() }) },
  );
