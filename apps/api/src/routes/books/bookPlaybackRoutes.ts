import { Elysia, t } from "elysia";

import { loadConfig } from "@rawkoon/api/config";
import { prisma } from "@rawkoon/api/db";
import { badRequest, notFound, unauthorized } from "@rawkoon/api/errors";
import { requireUser } from "@rawkoon/api/middleware/auth";
import {
  signGrant,
  verifyGrant,
} from "@rawkoon/api/services/books/downloadGrant";
import { parseByteRange, type ParsedByteRange } from "@rawkoon/shared/utils";

const GRANT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const CONTENT_CACHE_CONTROL = "private, immutable, max-age=31536000";

/**
 * A client timestamp is trusted backwards but not forwards.
 *
 * Last-write-wins uses the client `updated_at`, so a device clock set years in
 * the future would otherwise win every sync forever.
 */
export const clampClientTimestamp = (clientIso: string, now: Date): Date => {
  const parsed = new Date(clientIso);
  if (Number.isNaN(parsed.getTime())) return now;
  return parsed.getTime() > now.getTime() ? now : parsed;
};

/** parseByteRange returns inclusive end; Blob.slice expects exclusive end. */
export const sliceForRange = (range: ParsedByteRange) => ({
  start: range.start,
  endExclusive: range.end + 1,
});

export const bookPlaybackRoutes = new Elysia().use(requireUser).get(
  "/editions/:id/manifest",
  async ({ params, set }) => {
    const edition = await prisma.bookEdition.findUnique({
      where: { id: params.id },
      select: {
        id: true,
        offlineReady: true,
        book: {
          select: {
            id: true,
            title: true,
            authors: true,
          },
        },
        chapters: {
          orderBy: { index: "asc" },
          select: {
            index: true,
            title: true,
            startSecs: true,
            endSecs: true,
            bookFile: {
              select: {
                id: true,
                sizeBytes: true,
                sha256: true,
              },
            },
          },
        },
      },
    });
    if (!edition) return notFound(set, "Edition not found");
    if (!edition.offlineReady || edition.chapters.length === 0) {
      return badRequest(set, "Edition is not offline-ready");
    }

    const secret = loadConfig().SECRET_KEY;
    const expiresAt = Date.now() + GRANT_TTL_MS;

    return {
      edition_id: edition.id,
      book_id: edition.book.id,
      title: edition.book.title,
      authors: edition.book.authors,
      total_duration_secs: edition.chapters.at(-1)?.endSecs ?? 0,
      chapters: edition.chapters.map((chapter) => ({
        index: chapter.index,
        title: chapter.title,
        start_secs: chapter.startSecs,
        end_secs: chapter.endSecs,
        file_id: chapter.bookFile.id,
        size_bytes: Number(chapter.bookFile.sizeBytes),
        sha256: chapter.bookFile.sha256,
        url: `/api/books/files/${chapter.bookFile.id}/content?grant=${signGrant(
          {
            fileId: chapter.bookFile.id,
            variant: "original",
            grantId: crypto.randomUUID(),
            expiresAt,
          },
          secret,
        )}`,
      })),
    };
  },
  {
    params: t.Object({
      id: t.Numeric(),
    }),
  },
);

/**
 * Byte serving for chapter files. Signed grants are the only auth.
 *
 * Intentionally no requireUser: background URLSession downloads send no session
 * cookie, so session auth would 401 every valid background download.
 *
 * Never redirect from this route: background URLSession follows redirects
 * unconditionally, which can leak bytes to an unsigned target.
 */
export const bookContentRoutes = new Elysia().get(
  "/files/:fileId/content",
  async ({ params, query, request, set }) => {
    const grant = verifyGrant(query.grant ?? "", loadConfig().SECRET_KEY);
    if (!grant || grant.fileId !== params.fileId) {
      return unauthorized(set, "Invalid or expired download grant");
    }

    const file = await prisma.bookFile.findUnique({
      where: { id: params.fileId },
      select: {
        filePath: true,
        sizeBytes: true,
      },
    });
    if (!file) return notFound(set, "File not found");

    const size = Number(file.sizeBytes);
    const handle = Bun.file(file.filePath);
    const range = parseByteRange(request.headers.get("range"), size);

    if (range === "unsatisfiable") {
      return new Response(null, {
        status: 416,
        headers: {
          "Content-Range": `bytes */${size}`,
          "Accept-Ranges": "bytes",
        },
      });
    }

    if (range === null) {
      return new Response(handle.stream(), {
        status: 200,
        headers: {
          "Content-Type": "audio/mpeg",
          "Content-Length": String(size),
          "Accept-Ranges": "bytes",
          "Cache-Control": CONTENT_CACHE_CONTROL,
        },
      });
    }

    if (range.start === 0 && range.end === size - 1) {
      return new Response(handle.stream(), {
        status: 206,
        headers: {
          "Content-Type": "audio/mpeg",
          "Content-Range": `bytes ${range.start}-${range.end}/${size}`,
          "Content-Length": String(range.end - range.start + 1),
          "Accept-Ranges": "bytes",
          "Cache-Control": CONTENT_CACHE_CONTROL,
        },
      });
    }

    const { start, endExclusive } = sliceForRange(range);
    // @elysiajs/cors re-serves sliced BunFile handles from byte 0, so
    // `handle.slice(...)` or `handle.slice(...).stream()` can silently send the
    // whole file with status 206. This was measured on real requests, so keep a
    // materialized body here unless cors no longer rewrites sliced handles.
    const chunk = new Uint8Array(
      await handle.slice(start, endExclusive).arrayBuffer(),
    );
    return new Response(chunk, {
      status: 206,
      headers: {
        "Content-Type": "audio/mpeg",
        "Content-Range": `bytes ${range.start}-${range.end}/${size}`,
        "Content-Length": String(range.end - range.start + 1),
        "Accept-Ranges": "bytes",
        "Cache-Control": CONTENT_CACHE_CONTROL,
      },
    });
  },
  {
    params: t.Object({
      fileId: t.Numeric(),
    }),
    query: t.Object({
      grant: t.Optional(t.String()),
    }),
  },
);

export const bookProgressRoutes = new Elysia()
  .use(requireUser)
  .get("/progress", async ({ user }) => {
    const rows = await prisma.bookListeningProgress.findMany({
      where: { userId: user!.id },
      select: {
        editionId: true,
        positionSecs: true,
        totalDurationSecs: true,
        finished: true,
        updatedAt: true,
      },
      orderBy: { updatedAt: "desc" },
    });

    return {
      progress: rows.map((row) => ({
        edition_id: row.editionId,
        position_secs: row.positionSecs,
        total_duration_secs: row.totalDurationSecs,
        finished: row.finished,
        updated_at: row.updatedAt.toISOString(),
      })),
    };
  })
  .put(
    "/editions/:id/progress",
    async ({ params, body, user, set }) => {
      const edition = await prisma.bookEdition.findUnique({
        where: { id: params.id },
        select: { id: true },
      });
      if (!edition) return notFound(set, "Edition not found");

      const now = new Date();
      const updatedAt = clampClientTimestamp(body.updated_at, now);

      const existing = await prisma.bookListeningProgress.findUnique({
        where: {
          userId_editionId: {
            userId: user!.id,
            editionId: params.id,
          },
        },
        select: { updatedAt: true },
      });
      if (existing && existing.updatedAt > updatedAt) return { applied: false };

      const data = {
        positionSecs: body.position_secs,
        totalDurationSecs: body.total_duration_secs,
        finished: body.finished ?? false,
        updatedAt,
        receivedAt: now,
        deviceId: body.device_id ?? null,
      };

      await prisma.bookListeningProgress.upsert({
        where: {
          userId_editionId: {
            userId: user!.id,
            editionId: params.id,
          },
        },
        update: data,
        create: {
          ...data,
          userId: user!.id,
          editionId: params.id,
        },
      });

      return { applied: true };
    },
    {
      params: t.Object({
        id: t.Numeric(),
      }),
      body: t.Object({
        position_secs: t.Number(),
        total_duration_secs: t.Number(),
        finished: t.Optional(t.Boolean()),
        updated_at: t.String(),
        device_id: t.Optional(t.String()),
      }),
    },
  );
