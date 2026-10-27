import { stat } from "node:fs/promises";
import { z } from "zod";
import { extname } from "node:path";
import type { BunFile } from "bun";
import { Hono } from "hono";

import { loadConfig } from "@rawkoon/api/config";
import { badRequest, notFound, ok, unauthorized } from "@rawkoon/api/errors";
import type { Env } from "@rawkoon/api/honoEnv";
import { requireUser } from "@rawkoon/api/middleware/hono/auth";
import { jsonV, paramV, queryV } from "@rawkoon/api/middleware/validate";
import {
  signGrant,
  verifyGrant,
} from "@rawkoon/api/services/books/downloadGrant";
import {
  clampClientTimestamp,
  findBookFilePath,
  findManifestEdition,
  listListeningProgress,
  listReadingProgress,
  saveListeningProgress,
  saveReadingProgress,
} from "@rawkoon/api/services/books/playbackProgress";
import { parseByteRange, type ParsedByteRange } from "@rawkoon/shared/utils";
import type { BookManifestFile } from "@rawkoon/shared/types";

import { bookIdentityFromEdition } from "./progressIdentity";

type ChapterForGrouping = {
  startSecs: number;
  endSecs: number;
  bookFile: {
    id: number;
    sizeBytes: bigint;
    sha256: string | null;
    filePath: string;
  };
};

/**
 * Group chapters (ordered by index) into physical files. A single-file
 * audiobook has many chapters on one bookFile; each file is one download unit.
 */
export function buildManifestFiles(
  chapters: ChapterForGrouping[],
  grantUrlForFile: (fileId: number) => string,
): BookManifestFile[] {
  const byId = new Map<number, BookManifestFile>();
  for (const chapter of chapters) {
    const id = chapter.bookFile.id;
    const existing = byId.get(id);
    if (!existing) {
      byId.set(id, {
        id,
        start_secs: chapter.startSecs,
        duration_secs: chapter.endSecs - chapter.startSecs,
        size_bytes: Number(chapter.bookFile.sizeBytes),
        sha256: chapter.bookFile.sha256,
        url: grantUrlForFile(id),
        mime_type: contentTypeForPath(chapter.bookFile.filePath),
      });
    } else {
      existing.duration_secs = chapter.endSecs - existing.start_secs;
    }
  }
  return [...byId.values()];
}

const GRANT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const CONTENT_CACHE_CONTROL = "private, immutable, max-age=31536000";
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

export { clampClientTimestamp };

/** parseByteRange returns inclusive end; Blob.slice expects exclusive end. */
export const sliceForRange = (range: ParsedByteRange) => ({
  start: range.start,
  endExclusive: range.end + 1,
});

const RANGE_CHUNK_BYTES = 1 << 20;

/** Chunked, so a seek never waits for the rest of the file to load into memory. */
export const rangeStream = (
  handle: BunFile,
  start: number,
  endExclusive: number,
): ReadableStream<Uint8Array> => {
  let position = start;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (position >= endExclusive) {
        controller.close();
        return;
      }
      const next = Math.min(position + RANGE_CHUNK_BYTES, endExclusive);
      const chunk = await handle.slice(position, next).arrayBuffer();
      position = next;
      controller.enqueue(new Uint8Array(chunk));
    },
  });
};

const editionIdParam = z.object({ id: z.coerce.number() });

export const bookPlaybackRoutes = new Hono<Env>().get(
  "/editions/:id/manifest",
  requireUser,
  paramV(editionIdParam),
  async (c) => {
    const edition = await findManifestEdition(c.req.valid("param").id);
    if (!edition) return notFound("Edition not found");
    if (!edition.offlineReady || edition.chapters.length === 0) {
      return badRequest("Edition is not offline-ready");
    }

    const secret = loadConfig().SECRET_KEY;
    const expiresAt = Date.now() + GRANT_TTL_MS;
    const grantCache = new Map<number, string>();
    const grantUrlForFile = (fileId: number): string => {
      const cached = grantCache.get(fileId);
      if (cached) return cached;
      const url = `/api/books/files/${fileId}/content?grant=${signGrant(
        {
          fileId,
          variant: "original",
          grantId: crypto.randomUUID(),
          expiresAt,
        },
        secret,
      )}`;
      grantCache.set(fileId, url);
      return url;
    };

    return ok({
      edition_id: edition.id,
      book_id: edition.book.id,
      title: edition.book.title,
      authors: edition.book.authors,
      total_duration_secs: edition.chapters.at(-1)!.endSecs,
      files: buildManifestFiles(edition.chapters, grantUrlForFile),
      chapters: edition.chapters.map((chapter) => ({
        index: chapter.index,
        title: chapter.title,
        start_secs: chapter.startSecs,
        end_secs: chapter.endSecs,
        file_id: chapter.bookFile.id,
        size_bytes: Number(chapter.bookFile.sizeBytes),
        sha256: chapter.bookFile.sha256,
        url: grantUrlForFile(chapter.bookFile.id),
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

    const file = await findBookFilePath(params.fileId);
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
    return new Response(rangeStream(handle, start, endExclusive), {
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
    const rows = await listListeningProgress(c.get("user").id);

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
      const result = await saveListeningProgress(user.id, id, body);
      if (result === "edition_not_found") return notFound("Edition not found");
      if (result === "stale") return ok({ applied: false });

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
    const rows = await listReadingProgress(c.get("user").id);

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
      const result = await saveReadingProgress(user.id, id, body);
      if (result === "edition_not_found") return notFound("Edition not found");
      if (result === "spine_out_of_range") {
        return badRequest("spine_index is outside the spine");
      }
      if (result === "stale") return ok({ applied: false });

      return ok({ applied: true });
    },
  );
