import { Elysia, t } from "elysia";
import { stat } from "node:fs/promises";

import { requireUser } from "@rawkoon/api/middleware/auth";
import { prisma } from "@rawkoon/api/db";
import { badRequest, notFound } from "@rawkoon/api/errors";
import { buildManifest } from "@rawkoon/api/services/books/bookManifest";
import {
  listProgress,
  saveProgress,
} from "@rawkoon/api/services/books/bookProgress";

/**
 * Content types the reader and player need. An unknown format falls back to
 * octet-stream, which still streams — only in-browser rendering depends on the
 * type being right.
 */
const CONTENT_TYPES: Record<string, string> = {
  epub: "application/epub+zip",
  pdf: "application/pdf",
  cbz: "application/vnd.comicbook+zip",
  mobi: "application/x-mobipocket-ebook",
  azw3: "application/vnd.amazon.ebook",
  m4b: "audio/mp4",
  mp3: "audio/mpeg",
  flac: "audio/flac",
  ogg: "audio/ogg",
};

interface ParsedRange {
  start: number;
  end: number;
}

/**
 * Parse a single-range `Range` header against a known size.
 *
 * Returns null when there is no range to honour and "unsatisfiable" when the
 * client asked for bytes that do not exist — the caller answers 416 with a
 * `Content-Range` naming the real size, which is what lets a media element
 * recover instead of stalling. Multi-range requests are treated as no range:
 * answering the whole body is always a legal response to them.
 */
export const parseRange = (
  header: string | null | undefined,
  size: number,
): ParsedRange | null | "unsatisfiable" => {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return null;
  const [, rawStart, rawEnd] = match;
  if (rawStart === "" && rawEnd === "") return null;

  if (rawStart === "") {
    // Suffix form: the last N bytes.
    const suffix = Number(rawEnd);
    if (suffix <= 0) return "unsatisfiable";
    const start = Math.max(0, size - suffix);
    return { start, end: size - 1 };
  }

  const start = Number(rawStart);
  if (start >= size) return "unsatisfiable";
  const end = rawEnd === "" ? size - 1 : Math.min(Number(rawEnd), size - 1);
  if (end < start) return "unsatisfiable";
  return { start, end };
};

/**
 * Reading and listening.
 *
 *   GET /api/books/files/:fileId/content       — Range-capable byte stream
 *   GET /api/books/editions/:editionId/manifest
 *   GET /api/books/progress?editionIds=1,2
 *   PUT /api/books/editions/:editionId/progress
 *
 * The only client input to the byte route is a file id: the path comes from the
 * BookFile row, so there is no traversal surface to validate.
 */
export const bookReadRoutes = new Elysia()
  .use(requireUser)

  .get(
    "/files/:fileId/content",
    async ({ params, request, set }) => {
      const file = await prisma.bookFile.findUnique({
        where: { id: params.fileId },
        select: {
          filePath: true,
          fileName: true,
          format: true,
          sizeBytes: true,
          fileIno: true,
          fileMtimeMs: true,
        },
      });
      if (!file) return notFound(set, "Book file not found");

      const handle = Bun.file(file.filePath);
      if (!(await handle.exists())) {
        return notFound(set, "This file is missing from the library");
      }

      // The stored size can lag a replaced file, and Range maths against a
      // stale size hands the client bytes that are not there.
      const size = (await stat(file.filePath)).size;

      const contentType =
        CONTENT_TYPES[file.format] ?? "application/octet-stream";
      const etag = `"${file.fileIno ?? "x"}-${file.fileMtimeMs ?? 0}-${size}"`;

      const baseHeaders: Record<string, string> = {
        "Content-Type": contentType,
        "Accept-Ranges": "bytes",
        ETag: etag,
        // Content at a given id never changes: a replaced file gets a new row.
        "Cache-Control": "private, max-age=31536000, immutable",
        "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
      };

      if (request.headers.get("if-none-match") === etag) {
        return new Response(null, { status: 304, headers: baseHeaders });
      }

      const range = parseRange(request.headers.get("range"), size);

      if (range === "unsatisfiable") {
        return new Response(null, {
          status: 416,
          headers: { ...baseHeaders, "Content-Range": `bytes */${size}` },
        });
      }

      if (range) {
        const length = range.end - range.start + 1;
        return new Response(handle.slice(range.start, range.end + 1), {
          status: 206,
          headers: {
            ...baseHeaders,
            "Content-Range": `bytes ${range.start}-${range.end}/${size}`,
            "Content-Length": String(length),
          },
        });
      }

      return new Response(handle, {
        status: 200,
        headers: { ...baseHeaders, "Content-Length": String(size) },
      });
    },
    { params: t.Object({ fileId: t.Numeric() }) },
  )

  .get(
    "/editions/:editionId/manifest",
    async ({ params, user, set }) => {
      const manifest = await buildManifest(params.editionId, user!.id);
      if (!manifest) return notFound(set, "Edition not found");
      return { manifest };
    },
    { params: t.Object({ editionId: t.Numeric() }) },
  )

  .get(
    "/progress",
    async ({ query, user, set }) => {
      const ids = (query.editionIds ?? "")
        .split(",")
        .map((raw) => Number(raw.trim()))
        .filter((n) => Number.isInteger(n) && n > 0);
      if (ids.length === 0) {
        return badRequest(set, "editionIds must be a comma-separated id list");
      }
      return { progress: await listProgress(user!.id, ids) };
    },
    { query: t.Object({ editionIds: t.Optional(t.String()) }) },
  )

  .put(
    "/editions/:editionId/progress",
    async ({ params, body, user, set }) => {
      const clientUpdatedAt = new Date(body.client_updated_at);
      if (Number.isNaN(clientUpdatedAt.getTime())) {
        return badRequest(set, "client_updated_at must be an ISO 8601 date");
      }
      if (body.percent != null && (body.percent < 0 || body.percent > 1)) {
        return badRequest(set, "percent must be between 0 and 1");
      }

      const edition = await prisma.bookEdition.findUnique({
        where: { id: params.editionId },
        select: { id: true },
      });
      if (!edition) return notFound(set, "Edition not found");

      return saveProgress(user!.id, params.editionId, body);
    },
    {
      params: t.Object({ editionId: t.Numeric() }),
      body: t.Object({
        locator: t.Optional(t.Nullable(t.String())),
        percent: t.Optional(t.Nullable(t.Number())),
        position_secs: t.Optional(t.Nullable(t.Number())),
        file_id: t.Optional(t.Nullable(t.Number())),
        finished: t.Optional(t.Boolean()),
        client_updated_at: t.String(),
      }),
    },
  );
