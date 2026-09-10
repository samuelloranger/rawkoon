import { Hono } from "hono";
import { z } from "zod";

import type { Env } from "@rawkoon/api/honoEnv";
import { requireUser } from "@rawkoon/api/middleware/hono/auth";
import { jsonV, paramV } from "@rawkoon/api/middleware/validate";
import { prisma } from "@rawkoon/api/db";
import { badRequest, conflict, notFound, ok } from "@rawkoon/api/errors";
import {
  grabBookRelease,
  searchAndGrabBook,
  searchBookReleases,
} from "@rawkoon/api/services/books/bookGrabber";

const editionParams = z.object({
  id: z.coerce.number(),
  kind: z.union([z.literal("ebook"), z.literal("audiobook")]),
});

/**
 * Interactive search and grab.
 *   GET  /api/books/:id/editions/:kind/search   — list scored candidates
 *   POST /api/books/:id/editions/:kind/grab     — grab a chosen release
 *   POST /api/books/:id/editions/:kind/auto     — search and grab the best
 */
export const bookGrabRoutes = new Hono<Env>()
  .get(
    "/:id/editions/:kind/search",
    requireUser,
    paramV(editionParams),
    async (c) => {
      const params = c.req.valid("param");
      const edition = await prisma.bookEdition.findUnique({
        where: { bookId_kind: { bookId: params.id, kind: params.kind } },
        select: { id: true },
      });
      if (!edition) return notFound("Edition not found");

      const { releases, indexerWarnings, error } = await searchBookReleases(
        edition.id,
      );
      if (error) return badRequest(error);

      return ok({ releases, indexer_warnings: indexerWarnings });
    },
  )

  .post(
    "/:id/editions/:kind/grab",
    requireUser,
    paramV(editionParams),
    jsonV(
      z.object({
        release_title: z.string(),
        download_url: z.string().optional(),
        magnet_url: z.string().optional(),
        indexer: z.string().nullable().optional(),
      }),
    ),
    async (c) => {
      const params = c.req.valid("param");
      const body = c.req.valid("json");
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
      return ok({ grabbed: true, release_title: result.releaseTitle });
    },
  )

  .post(
    "/:id/editions/:kind/auto",
    requireUser,
    paramV(editionParams),
    async (c) => {
      const params = c.req.valid("param");
      const edition = await prisma.bookEdition.findUnique({
        where: { bookId_kind: { bookId: params.id, kind: params.kind } },
        select: { id: true },
      });
      if (!edition) return notFound("Edition not found");

      const result = await searchAndGrabBook(edition.id);
      if (!result.grabbed) return conflict(result.reason);
      return ok({ grabbed: true, release_title: result.releaseTitle });
    },
  );
