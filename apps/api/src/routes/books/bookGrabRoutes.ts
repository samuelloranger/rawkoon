import { Elysia, t } from "elysia";

import { requireUser } from "@rawkoon/api/middleware/auth";
import { prisma } from "@rawkoon/api/db";
import { badRequest, notFound } from "@rawkoon/api/errors";
import {
  grabBookRelease,
  searchAndGrabBook,
  searchBookReleases,
} from "@rawkoon/api/services/books/bookGrabber";

/**
 * Interactive search and grab.
 *   GET  /api/books/:id/editions/:kind/search   — list scored candidates
 *   POST /api/books/:id/editions/:kind/grab     — grab a chosen release
 *   POST /api/books/:id/editions/:kind/auto     — search and grab the best
 */
export const bookGrabRoutes = new Elysia()
  .use(requireUser)

  .get(
    "/:id/editions/:kind/search",
    async ({ params, set }) => {
      const edition = await prisma.bookEdition.findUnique({
        where: { bookId_kind: { bookId: params.id, kind: params.kind } },
        select: { id: true },
      });
      if (!edition) return notFound(set, "Edition not found");

      const { releases, indexerWarnings, error } = await searchBookReleases(
        edition.id,
      );
      if (error) return badRequest(set, error);

      return { releases, indexer_warnings: indexerWarnings };
    },
    {
      params: t.Object({
        id: t.Numeric(),
        kind: t.Union([t.Literal("ebook"), t.Literal("audiobook")]),
      }),
    },
  )

  .post(
    "/:id/editions/:kind/grab",
    async ({ params, body, set }) => {
      const edition = await prisma.bookEdition.findUnique({
        where: { bookId_kind: { bookId: params.id, kind: params.kind } },
        select: { id: true },
      });
      if (!edition) return notFound(set, "Edition not found");

      const url = body.download_url?.trim() || body.magnet_url?.trim();
      if (!url) {
        return badRequest(set, "download_url or magnet_url is required");
      }

      const result = await grabBookRelease({
        editionId: edition.id,
        downloadUrl: url,
        releaseTitle: body.release_title,
        indexer: body.indexer ?? null,
      });

      if (!result.grabbed) {
        set.status = 409;
        return { grabbed: false, reason: result.reason };
      }
      return { grabbed: true, release_title: result.releaseTitle };
    },
    {
      params: t.Object({
        id: t.Numeric(),
        kind: t.Union([t.Literal("ebook"), t.Literal("audiobook")]),
      }),
      body: t.Object({
        release_title: t.String(),
        download_url: t.Optional(t.String()),
        magnet_url: t.Optional(t.String()),
        indexer: t.Optional(t.Nullable(t.String())),
      }),
    },
  )

  .post(
    "/:id/editions/:kind/auto",
    async ({ params, set }) => {
      const edition = await prisma.bookEdition.findUnique({
        where: { bookId_kind: { bookId: params.id, kind: params.kind } },
        select: { id: true },
      });
      if (!edition) return notFound(set, "Edition not found");

      const result = await searchAndGrabBook(edition.id);
      if (!result.grabbed) {
        set.status = 409;
        return { grabbed: false, reason: result.reason };
      }
      return { grabbed: true, release_title: result.releaseTitle };
    },
    {
      params: t.Object({
        id: t.Numeric(),
        kind: t.Union([t.Literal("ebook"), t.Literal("audiobook")]),
      }),
    },
  );
