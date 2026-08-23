import { Elysia, t } from "elysia";
import { stat } from "node:fs/promises";

import { requireUser } from "@rawkoon/api/middleware/auth";
import { prisma } from "@rawkoon/api/db";
import { badRequest, notFound } from "@rawkoon/api/errors";
import { parseByteRange } from "@rawkoon/shared/utils";
import {
  buildManifest,
  naturalCompare,
} from "@rawkoon/api/services/books/bookManifest";
import {
  buildStreamLayout,
  isConcatEligible,
  sliceLayout,
  type StreamLayout,
} from "@rawkoon/api/services/books/bookStreamLayout";
import { getJsonCache, setJsonCache } from "@rawkoon/api/services/cache";
import { listReading } from "@rawkoon/api/services/books/bookReading";
import { logActivity } from "@rawkoon/api/utils/activityLogs";
import {
  finishProgress,
  listProgress,
  resetProgress,
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

/** Reading-list size: a whole number, at least one, never more than 24. */
export const clampLimit = (raw: number | undefined): number => {
  if (raw == null || !Number.isFinite(raw)) return 6;
  return Math.min(24, Math.max(1, Math.floor(raw)));
};

/**
 * Kept as a named export because the route's tests drive it directly. The
 * implementation lives in @rawkoon/shared so the service worker, which has to
 * answer the same Range requests from Cache Storage, cannot drift from it.
 */
export const parseRange = parseByteRange;

/**
 * Reading and listening.
 *
 *   GET /api/books/files/:fileId/content       — Range-capable byte stream
 *   GET /api/books/editions/:editionId/manifest
 *   GET /api/books/progress?editionIds=1,2
 *   GET /api/books/reading?limit=6
 *   PUT /api/books/editions/:editionId/progress
 *   POST /api/books/editions/:editionId/progress/finish
 *   POST /api/books/editions/:editionId/progress/reset
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
      const info = await stat(file.filePath);
      const size = info.size;

      const contentType =
        CONTENT_TYPES[file.format] ?? "application/octet-stream";
      // Validators come from the same stat as the size. Built from the stored
      // row instead, a file replaced in place at the same size kept its old
      // ETag, so a client holding the previous bytes was told 304 Not Modified
      // and never saw the new ones.
      const etag = `"${info.ino}-${Math.trunc(info.mtimeMs)}-${size}"`;

      const baseHeaders: Record<string, string> = {
        "Content-Type": contentType,
        "Accept-Ranges": "bytes",
        ETag: etag,
        // Long-lived but revalidatable. `immutable` told clients never to ask
        // again, which is only true while nothing replaces a file in place —
        // and an upgrade does exactly that.
        "Cache-Control": "private, max-age=31536000",
        "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
      };

      if (request.headers.get("if-none-match") === etag) {
        return new Response(null, { status: 304, headers: baseHeaders });
      }

      // A conditional range is a resumed transfer: if the resource changed
      // since the client last saw it, the only safe answer is the whole thing,
      // not a slice of different bytes stitched onto its old buffer.
      const ifRange = request.headers.get("if-range");
      const rangeIsSafe = !ifRange || ifRange === etag;
      const range = rangeIsSafe
        ? parseRange(request.headers.get("range"), size)
        : null;

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

  /**
   * A multi-file audiobook as one seekable resource.
   *
   * The player used to flatten N files into a virtual timeline in JavaScript,
   * swapping `src` at every boundary and queueing seeks on `loadedmetadata`.
   * Scrubbing, the clock and resume-after-error all broke in that seam. Served
   * as one stream, the browser does the seeking and the range resumption
   * itself, natively, and gets none of it wrong.
   *
   * Only for editions whose files concatenate into a valid stream — uniform CBR
   * mp3. Everything else 404s here and keeps the per-file path.
   */
  .get(
    "/editions/:editionId/stream",
    async ({ params, request, set }) => {
      const rows = await prisma.bookFile.findMany({
        where: { editionId: params.editionId },
        select: {
          id: true,
          filePath: true,
          fileName: true,
          format: true,
          audioBitrate: true,
        },
      });
      if (rows.length === 0) return notFound(set, "Edition has no files");

      // Name order IS the timeline, exactly as the manifest builds it. Reusing
      // naturalCompare is load-bearing: a different order here would serve
      // chapters in one sequence and place them at another's offsets.
      const files = [...rows].sort((a, b) =>
        naturalCompare(a.fileName, b.fileName),
      );
      if (!isConcatEligible(files)) {
        return notFound(set, "This edition is not served as a single stream");
      }

      // 83 stat+open calls is far too much to repeat per range request, and a
      // player issues many. Short TTL rather than none, so a re-import is
      // picked up without an explicit invalidation.
      const cacheKey = `books:stream:layout:${params.editionId}`;
      let layout = await getJsonCache<StreamLayout>(cacheKey);
      if (!layout) {
        layout = await buildStreamLayout(files);
        if (layout.parts.length === 0) {
          return notFound(set, "Edition has no readable audio");
        }
        await setJsonCache(cacheKey, layout, 300);
      }

      const size = layout.totalBytes;
      const baseHeaders: Record<string, string> = {
        "Content-Type": "audio/mpeg",
        "Accept-Ranges": "bytes",
        ETag: layout.etag,
        "Cache-Control": "private, max-age=31536000",
      };

      if (request.headers.get("if-none-match") === layout.etag) {
        return new Response(null, { status: 304, headers: baseHeaders });
      }

      // A conditional range is a resumed transfer: if the files changed since
      // the client last saw them, stitching new bytes onto its old buffer would
      // hand the decoder a corrupt stream.
      const ifRange = request.headers.get("if-range");
      const rangeIsSafe = !ifRange || ifRange === layout.etag;
      const range = rangeIsSafe
        ? parseRange(request.headers.get("range"), size)
        : null;

      if (range === "unsatisfiable") {
        return new Response(null, {
          status: 416,
          headers: { ...baseHeaders, "Content-Range": `bytes */${size}` },
        });
      }

      const start = range ? range.start : 0;
      const end = range ? range.end : size - 1;
      const slices = sliceLayout(layout, start, end);

      const body = new ReadableStream<Uint8Array>({
        async start(controller) {
          try {
            for (const slice of slices) {
              const chunk = Bun.file(slice.path).slice(slice.start, slice.end);
              const reader = chunk.stream().getReader();
              for (;;) {
                const { done, value } = await reader.read();
                if (done) break;
                controller.enqueue(value);
              }
            }
            controller.close();
          } catch (e) {
            // A client that seeks away mid-response aborts the stream; that is
            // normal and must not be logged as a failure.
            controller.error(e);
          }
        },
      });

      return new Response(body, {
        status: range ? 206 : 200,
        headers: {
          ...baseHeaders,
          "Content-Length": String(end - start + 1),
          ...(range
            ? { "Content-Range": `bytes ${start}-${end}/${size}` }
            : {}),
        },
      });
    },
    { params: t.Object({ editionId: t.Numeric() }) },
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

  .get(
    "/reading",
    async ({ query, user }) => ({
      // Clamped both ways, and to a whole number: a negative take paginates
      // backwards past the cap, and a fractional one is a Prisma error rather
      // than a 400.
      reading: await listReading(user!.id, clampLimit(query.limit)),
    }),
    { query: t.Object({ limit: t.Optional(t.Numeric()) }) },
  )

  .post(
    "/editions/:editionId/progress/finish",
    async ({ params, user, set }) => {
      const edition = await prisma.bookEdition.findUnique({
        where: { id: params.editionId },
        select: { id: true },
      });
      if (!edition) return notFound(set, "Edition not found");
      return { progress: await finishProgress(user!.id, params.editionId) };
    },
    { params: t.Object({ editionId: t.Numeric() }) },
  )

  .post(
    "/editions/:editionId/progress/reset",
    async ({ params, user, set }) => {
      const edition = await prisma.bookEdition.findUnique({
        where: { id: params.editionId },
        select: { id: true },
      });
      if (!edition) return notFound(set, "Edition not found");
      return { progress: await resetProgress(user!.id, params.editionId) };
    },
    { params: t.Object({ editionId: t.Numeric() }) },
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
  )

  /**
   * Playback diagnostics.
   *
   * A media error on a locked phone is invisible: the byte route cannot tell a
   * dropped socket from a finished response, and nobody reads a console on a
   * device with the screen off. Recording the element's clock alongside the
   * offset the engine chose to resume from is what separates "the connection
   * dropped and we resumed correctly" from "we rewound the listener", which is
   * otherwise indistinguishable after the fact.
   *
   * Deliberately tolerant: every field but the edition is optional, and it
   * answers `recorded: true` regardless, because this is called from the
   * player's own error handler and must never add a failure there.
   */
  .post(
    "/playback-diagnostic",
    async ({ body, user }) => {
      await logActivity({
        type: "book_playback_error",
        userId: user!.id,
        payload: {
          edition_id: body.edition_id,
          file_id: body.file_id ?? null,
          file_index: body.file_index ?? null,
          error_code: body.error_code ?? null,
          current_time: body.current_time ?? null,
          resume_offset: body.resume_offset ?? null,
          retry_attempt: body.retry_attempt ?? null,
          online: body.online ?? null,
        },
      });
      return { recorded: true };
    },
    {
      body: t.Object({
        edition_id: t.Numeric(),
        file_id: t.Optional(t.Nullable(t.Numeric())),
        file_index: t.Optional(t.Nullable(t.Numeric())),
        /** MediaError.code: 1 aborted, 2 network, 3 decode, 4 unsupported. */
        error_code: t.Optional(t.Nullable(t.Numeric())),
        current_time: t.Optional(t.Nullable(t.Number())),
        resume_offset: t.Optional(t.Nullable(t.Number())),
        retry_attempt: t.Optional(t.Nullable(t.Numeric())),
        online: t.Optional(t.Nullable(t.Boolean())),
      }),
    },
  )

  /**
   * Batched playback journal.
   *
   * Supersedes the single-event diagnostic above, which recorded nothing
   * useful: it posted from the player's error handler with `keepalive`, at the
   * one moment the connection is dead and iOS is freezing the page, so the
   * report was the first thing dropped. Its silence was indistinguishable from
   * "no error happened", which is why the rewind is still unexplained.
   *
   * The client now journals to IndexedDB and ships batches on a later launch,
   * so entries arrive late and out of order — `at` is the client's own clock
   * and is the only usable ordering. One activity row per batch keeps this to
   * a single queue job however chatty a session was.
   */
  .post(
    "/playback-journal",
    async ({ body, user }) => {
      if (body.events.length === 0) return { recorded: 0 };
      await logActivity({
        type: "book_playback_trace",
        userId: user!.id,
        payload: { events: body.events },
      });
      return { recorded: body.events.length };
    },
    {
      body: t.Object({
        // Capped so one request cannot enqueue an unbounded payload; the client
        // batches to the same size.
        events: t.Array(
          t.Object({
            event: t.String(),
            edition_id: t.Numeric(),
            file_id: t.Optional(t.Nullable(t.Numeric())),
            file_index: t.Optional(t.Nullable(t.Numeric())),
            error_code: t.Optional(t.Nullable(t.Numeric())),
            current_time: t.Optional(t.Nullable(t.Number())),
            ready_state: t.Optional(t.Nullable(t.Numeric())),
            resume_offset: t.Optional(t.Nullable(t.Number())),
            position: t.Optional(t.Nullable(t.Number())),
            retry_attempt: t.Optional(t.Nullable(t.Numeric())),
            reason: t.Optional(t.Nullable(t.String())),
            online: t.Optional(t.Nullable(t.Boolean())),
            visibility: t.Optional(t.Nullable(t.String())),
            at: t.Optional(t.Nullable(t.String())),
          }),
          { maxItems: 50 },
        ),
      }),
    },
  );
