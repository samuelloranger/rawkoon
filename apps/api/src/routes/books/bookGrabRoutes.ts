import { Elysia } from "elysia";
import { z } from "zod";

import { requireUser } from "@rawkoon/api/middleware/auth";
import { prisma } from "@rawkoon/api/db";
import { badRequest, conflict, notFound } from "@rawkoon/api/errors";
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
      if (!edition) return notFound("Edition not found");

      const { releases, indexerWarnings, error } = await searchBookReleases(
        edition.id,
      );
      if (error) return badRequest(error);

      return { releases, indexer_warnings: indexerWarnings };
    },
    {
      params: z.object({
        id: z.coerce.number(),
        kind: z.union([z.literal("ebook"), z.literal("audiobook")]),
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
      if (!edition) return notFound("Edition not found");

      const url = body.download_url?.trim() || body.magnet_url?.trim();
      if (!url) {
        return badRequest("download_url or magnet_url is required");
      }

      const result = await grabBookRelease({
        editionId: edition.id,
        downloadUrl: url,
        releaseTitle: body.release_title,
        indexer: body.indexer ?? null,
      });

      // Refusals use the shared conflict() helper: the whole app returns
      // { error } on failure, and the web client's error extractor reads
      // exactly that field. Returning { reason } instead lost the message and
      // surfaced a bare "HTTP error! status: 409".
      if (!result.grabbed) return conflict(result.reason);
      return { grabbed: true, release_title: result.releaseTitle };
    },
    {
      params: z.object({
        id: z.coerce.number(),
        kind: z.union([z.literal("ebook"), z.literal("audiobook")]),
      }),
      body: z.object({
        release_title: z.string(),
        download_url: z.string().optional(),
        magnet_url: z.string().optional(),
        indexer: z.string().nullable().optional(),
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
      if (!edition) return notFound("Edition not found");

      const result = await searchAndGrabBook(edition.id);
      if (!result.grabbed) return conflict(result.reason);
      return { grabbed: true, release_title: result.releaseTitle };
    },
    {
      params: z.object({
        id: z.coerce.number(),
        kind: z.union([z.literal("ebook"), z.literal("audiobook")]),
      }),
    },
  );
