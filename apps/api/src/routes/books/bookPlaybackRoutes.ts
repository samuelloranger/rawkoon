import { stat } from "node:fs/promises";
import { z } from "zod";
import { extname } from "node:path";
import { Hono } from "hono";

import { loadConfig } from "@rawkoon/api/config";
import { prisma } from "@rawkoon/api/db";
import { badRequest, notFound, ok, unauthorized } from "@rawkoon/api/errors";
import type { Env } from "@rawkoon/api/honoEnv";
import { requireUser } from "@rawkoon/api/middleware/hono/auth";
import { jsonV, paramV, queryV } from "@rawkoon/api/middleware/validate";
import {
  signGrant,
  verifyGrant,
} from "@rawkoon/api/services/books/downloadGrant";
import { applyListeningCredit } from "@rawkoon/api/services/books/listeningStats";
import { parseByteRange, type ParsedByteRange } from "@rawkoon/shared/utils";

import { bookIdentityFromEdition } from "./progressIdentity";

const GRANT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const CONTENT_CACHE_CONTROL = "private, immutable, max-age=31536000";
const progressBookSelect = {
  edition: {
    select: {
      book: {
        select: { id: true, title: true, authors: true, coverUrl: true },
      },
    },
  },
} as const;
const contentTypeForPath = (filePath: string): string => {
  switch (extname(filePath).toLowerCase()) {
    case ".mp3":
      return "audio/mpeg";
    case ".m4b":
    case ".m4a":
      return "audio/mp4";
    case ".flac":
      return "audio/flac";
    case ".ogg":
    case ".opus":
      return "audio/ogg";
    case ".epub":
      return "application/epub+zip";
    default:
      return "audio/mpeg";
  }
};

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

const editionIdParam = z.object({ id: z.coerce.number() });

export const bookPlaybackRoutes = new Hono<Env>().get(
  "/editions/:id/manifest",
  requireUser,
  paramV(editionIdParam),
  async (c) => {
    const edition = await prisma.bookEdition.findUnique({
      where: { id: c.req.valid("param").id },
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
    if (!edition) return notFound("Edition not found");
    if (!edition.offlineReady || edition.chapters.length === 0) {
      return badRequest("Edition is not offline-ready");
    }

    const secret = loadConfig().SECRET_KEY;
    const expiresAt = Date.now() + GRANT_TTL_MS;

    return ok({
      edition_id: edition.id,
      book_id: edition.book.id,
      title: edition.book.title,
      authors: edition.book.authors,
      total_duration_secs: edition.chapters.at(-1)!.endSecs,
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
    });
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
export const bookContentRoutes = new Hono<Env>().get(
  "/files/:fileId/content",
  paramV(z.object({ fileId: z.coerce.number() })),
  queryV(z.object({ grant: z.string().optional() })),
  async (c) => {
    const params = c.req.valid("param");
    const query = c.req.valid("query");
    const grant = verifyGrant(query.grant ?? "", loadConfig().SECRET_KEY);
    if (!grant || grant.fileId !== params.fileId) {
      return unauthorized("Invalid or expired download grant");
    }
    // Datasaver files are not generated yet, so only "original" is serveable.
    if (grant.variant !== "original") return notFound("File not found");

    const file = await prisma.bookFile.findUnique({
      where: { id: params.fileId },
      select: {
        filePath: true,
      },
    });
    if (!file) return notFound("File not found");

    const handle = Bun.file(file.filePath);
    const size = handle.size;
    if (size === 0 && !(await handle.exists()))
      return notFound("File not found");

    let mtimeMs = 0;
    try {
      mtimeMs = Math.trunc((await stat(file.filePath)).mtimeMs);
    } catch {
      return notFound("File not found");
    }

    const etag = `"${size}-${mtimeMs}"`;
    const contentType = contentTypeForPath(file.filePath);
    const range = parseByteRange(c.req.raw.headers.get("range"), size);

    if (range === "unsatisfiable") {
      return new Response(null, {
        status: 416,
        headers: {
          "Content-Range": `bytes */${size}`,
          "Accept-Ranges": "bytes",
          ETag: etag,
        },
      });
    }

    if (range === null) {
      return new Response(handle.stream(), {
        status: 200,
        headers: {
          "Content-Type": contentType,
          "Content-Length": String(size),
          "Accept-Ranges": "bytes",
          "Cache-Control": CONTENT_CACHE_CONTROL,
          ETag: etag,
        },
      });
    }

    if (range.start === 0 && range.end === size - 1) {
      return new Response(handle.stream(), {
        status: 206,
        headers: {
          "Content-Type": contentType,
          "Content-Range": `bytes ${range.start}-${range.end}/${size}`,
          "Content-Length": String(range.end - range.start + 1),
          "Accept-Ranges": "bytes",
          "Cache-Control": CONTENT_CACHE_CONTROL,
          ETag: etag,
        },
      });
    }

    const { start, endExclusive } = sliceForRange(range);
    // Defensive: a cors layer re-serving a sliced BunFile handle from byte 0 was
    // measured to silently send the whole file with a 206 (originally under
    // @elysiajs/cors). Materializing the chunk here is immune to that, so keep it.
    const chunk = new Uint8Array(
      await handle.slice(start, endExclusive).arrayBuffer(),
    );
    return new Response(chunk, {
      status: 206,
      headers: {
        "Content-Type": contentType,
        "Content-Range": `bytes ${range.start}-${range.end}/${size}`,
        "Content-Length": String(range.end - range.start + 1),
        "Accept-Ranges": "bytes",
        "Cache-Control": CONTENT_CACHE_CONTROL,
        ETag: etag,
      },
    });
  },
);

export const bookProgressRoutes = new Hono<Env>()
  .get("/progress", requireUser, async (c) => {
    const rows = await prisma.bookListeningProgress.findMany({
      where: { userId: c.get("user").id },
      select: {
        editionId: true,
        positionSecs: true,
        totalDurationSecs: true,
        finished: true,
        updatedAt: true,
        ...progressBookSelect,
      },
      orderBy: { updatedAt: "desc" },
    });

    return ok({
      progress: rows.flatMap((row) => {
        const identity = bookIdentityFromEdition(row.edition);
        if (!identity) return [];
        return [
          {
            edition_id: row.editionId,
            ...identity,
            position_secs: row.positionSecs,
            total_duration_secs: row.totalDurationSecs,
            finished: row.finished,
            updated_at: row.updatedAt.toISOString(),
          },
        ];
      }),
    });
  })
  .put(
    "/editions/:id/progress",
    requireUser,
    paramV(editionIdParam),
    jsonV(
      z.object({
        position_secs: z.number(),
        total_duration_secs: z.number(),
        finished: z.boolean().optional(),
        updated_at: z.string(),
        device_id: z.string().optional(),
      }),
    ),
    async (c) => {
      const user = c.get("user");
      const { id } = c.req.valid("param");
      const body = c.req.valid("json");
      const edition = await prisma.bookEdition.findUnique({
        where: { id },
        select: { id: true },
      });
      if (!edition) return notFound("Edition not found");

      const now = new Date();
      const updatedAt = clampClientTimestamp(body.updated_at, now);

      const existing = await prisma.bookListeningProgress.findUnique({
        where: {
          userId_editionId: { userId: user.id, editionId: id },
        },
        select: { updatedAt: true, positionSecs: true, receivedAt: true },
      });
      if (existing && existing.updatedAt > updatedAt)
        return ok({ applied: false });

      const baseData = {
        positionSecs: body.position_secs,
        totalDurationSecs: body.total_duration_secs,
        updatedAt,
        receivedAt: now,
        deviceId: body.device_id ?? null,
      };

      const updateData = {
        ...baseData,
        ...(body.finished === undefined ? {} : { finished: body.finished }),
      };

      await prisma.bookListeningProgress.upsert({
        where: {
          userId_editionId: { userId: user.id, editionId: id },
        },
        update: updateData,
        create: {
          ...baseData,
          finished: body.finished ?? false,
          userId: user.id,
          editionId: id,
        },
      });

      await applyListeningCredit({
        userId: user.id,
        created: !existing,
        previous: existing,
        newPosition: body.position_secs,
        receivedAt: now,
      });

      return ok({ applied: true });
    },
  );

/**
 * Reading position for ebook editions.
 *
 * Same last-write-wins rule as bookProgressRoutes — the client clock is
 * clamped to server time on receipt, and an older write is dropped rather than
 * allowed to walk a reader backwards from another device.
 */
export const bookReadingProgressRoutes = new Hono<Env>()
  .get("/reading-progress", requireUser, async (c) => {
    const rows = await prisma.bookReadingProgress.findMany({
      where: { userId: c.get("user").id },
      select: {
        editionId: true,
        fileId: true,
        spineIndex: true,
        spinePath: true,
        spineCount: true,
        scrollFraction: true,
        locator: true,
        finished: true,
        updatedAt: true,
        ...progressBookSelect,
      },
      orderBy: { updatedAt: "desc" },
    });

    return ok({
      progress: rows.flatMap((row) => {
        const identity = bookIdentityFromEdition(row.edition);
        if (!identity) return [];
        return [
          {
            edition_id: row.editionId,
            ...identity,
            file_id: row.fileId,
            spine_index: row.spineIndex,
            spine_path: row.spinePath,
            spine_count: row.spineCount,
            scroll_fraction: row.scrollFraction,
            locator: row.locator,
            finished: row.finished,
            updated_at: row.updatedAt.toISOString(),
          },
        ];
      }),
    });
  })
  .put(
    "/editions/:id/reading-progress",
    requireUser,
    paramV(editionIdParam),
    jsonV(
      z.object({
        file_id: z.coerce.number().nullable().optional(),
        spine_index: z.coerce.number(),
        spine_path: z.string().min(1),
        spine_count: z.coerce.number().min(1),
        scroll_fraction: z.number(),
        locator: z.string().nullable().optional(),
        finished: z.boolean().optional(),
        updated_at: z.string(),
        device_id: z.string().optional(),
      }),
    ),
    async (c) => {
      const user = c.get("user");
      const { id } = c.req.valid("param");
      const body = c.req.valid("json");
      const edition = await prisma.bookEdition.findUnique({
        where: { id },
        select: { id: true },
      });
      if (!edition) return notFound("Edition not found");

      if (body.spine_index < 0 || body.spine_index >= body.spine_count) {
        return badRequest("spine_index is outside the spine");
      }

      const now = new Date();
      const updatedAt = clampClientTimestamp(body.updated_at, now);

      const existing = await prisma.bookReadingProgress.findUnique({
        where: {
          userId_editionId: { userId: user.id, editionId: id },
        },
        select: { updatedAt: true },
      });
      if (existing && existing.updatedAt > updatedAt)
        return ok({ applied: false });

      const baseData = {
        fileId: body.file_id ?? null,
        spineIndex: body.spine_index,
        spinePath: body.spine_path,
        spineCount: body.spine_count,
        // Clamped rather than rejected: a client that reports 1.0000001 after a
        // bounce-scroll should not lose its position over it.
        scrollFraction: Math.min(Math.max(body.scroll_fraction, 0), 1),
        locator: body.locator ?? null,
        updatedAt,
        receivedAt: now,
        deviceId: body.device_id ?? null,
      };

      await prisma.bookReadingProgress.upsert({
        where: {
          userId_editionId: { userId: user.id, editionId: id },
        },
        update: {
          ...baseData,
          ...(body.finished === undefined ? {} : { finished: body.finished }),
        },
        create: {
          ...baseData,
          finished: body.finished ?? false,
          userId: user.id,
          editionId: id,
        },
      });

      return ok({ applied: true });
    },
  );
