import { Hono } from "hono";
import { z } from "zod";
import type {
  ClipDeleteAllResponse,
  ClipRecutRequest,
  ClipRetryResponse,
  ClipSettingsPatch,
  ClipStatusResponse,
} from "@rawkoon/shared/types";
import { badRequest, conflict, notFound, ok } from "@rawkoon/api/errors";
import type { Env } from "@rawkoon/api/honoEnv";
import { requireAdmin, requireUser } from "@rawkoon/api/middleware/hono/auth";
import { jsonV, queryV } from "@rawkoon/api/middleware/validate";
import { ClipSafetyError } from "@rawkoon/api/services/clips/clipGuard";
import {
  clipsForMedia,
  deleteAllClips,
  findClipByTmdb,
  getClipProgress,
  loadClipSettings,
  recutClip,
  retryFailed,
  updateClipSettings,
} from "@rawkoon/api/services/clips/clipService";
import {
  ClipStoreError,
  statClip,
} from "@rawkoon/api/services/clips/clipStore";

const settingsPatch: z.ZodType<ClipSettingsPatch> = z.object({
  enabled: z.boolean().optional(),
  paused: z.boolean().optional(),
});
const recutBody: z.ZodType<ClipRecutRequest> = z.object({
  start_sec: z
    .number()
    .finite()
    .min(0)
    .max(24 * 3600),
});
const fileQuery = z.object({
  tmdbId: z.coerce.number().int().positive(),
  type: z.enum(["movie", "show"]),
  season: z.coerce.number().int().min(0).optional(),
});
const idParam = z.coerce.number().int().positive();

/** `bytes=a-b`, `bytes=a-`, `bytes=-n`. Null = unsatisfiable or malformed. */
export function parseRange(
  header: string,
  size: number,
): { start: number; end: number } | null {
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m || (m[1] === "" && m[2] === "")) return null;
  let start: number;
  let end: number;
  if (m[1] === "") {
    start = Math.max(0, size - Number(m[2]));
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === "" ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  return start > end || start >= size ? null : { start, end };
}

// Mounted at /api/clips. Guards are per route: the TV-facing pair needs any
// signed-in user (Bearer or session), everything else an admin.
export const clipsRoutes = new Hono<Env>()
  .get("/status", requireUser, async () => {
    const body: ClipStatusResponse = {
      enabled: (await loadClipSettings()).enabled,
    };
    return ok(body);
  })
  // The path is built from the matched row's id; no client-supplied path parts.
  .get("/file", requireUser, queryV(fileQuery), async (c) => {
    if (!(await loadClipSettings()).enabled) return notFound("No clip");
    const { tmdbId, type, season } = c.req.valid("query");
    const row = await findClipByTmdb(tmdbId, type, season);
    // A symlinked or hardlinked clip file is treated as no clip.
    const file = row
      ? await statClip(row.id).catch((e) => {
          if (e instanceof ClipStoreError) return null;
          throw e;
        })
      : null;
    if (!row || !file) return notFound("No clip");

    const etag = `"${row.id}-${file.size}-${Math.floor(file.mtimeMs)}"`;
    const headers: Record<string, string> = {
      "Content-Type": "video/mp4",
      "Accept-Ranges": "bytes",
      "Cache-Control": "private, no-cache",
      ETag: etag,
    };
    if (c.req.header("if-none-match") === etag) {
      return new Response(null, { status: 304, headers });
    }
    const rangeHeader = c.req.header("range");
    const blob = Bun.file(file.path);
    if (!rangeHeader) {
      return new Response(blob, {
        headers: { ...headers, "Content-Length": String(file.size) },
      });
    }
    const range = parseRange(rangeHeader, file.size);
    if (!range) {
      return new Response(null, {
        status: 416,
        headers: { ...headers, "Content-Range": `bytes */${file.size}` },
      });
    }
    return new Response(blob.slice(range.start, range.end + 1), {
      status: 206,
      headers: {
        ...headers,
        "Content-Length": String(range.end - range.start + 1),
        "Content-Range": `bytes ${range.start}-${range.end}/${file.size}`,
      },
    });
  })
  .get("/settings", requireAdmin, async () => ok(await loadClipSettings()))
  .put("/settings", requireAdmin, jsonV(settingsPatch), async (c) => {
    try {
      return ok(await updateClipSettings(c.req.valid("json")));
    } catch (e) {
      if (e instanceof ClipSafetyError) return conflict(e.message);
      throw e;
    }
  })
  .get("/progress", requireAdmin, async () => ok(await getClipProgress()))
  .post("/retry", requireAdmin, async () => {
    const body: ClipRetryResponse = { retried: await retryFailed() };
    return ok(body);
  })
  .post("/delete-all", requireAdmin, async () => {
    try {
      const r = await deleteAllClips();
      if (!r.ok) {
        return conflict(
          r.reason === "running"
            ? "A clip is still being cut; try again when it finishes"
            : "Turn preview clips off before deleting them",
        );
      }
      const body: ClipDeleteAllResponse = {
        deleted_files: r.files,
        freed_bytes: r.bytes,
      };
      return ok(body);
    } catch (e) {
      if (e instanceof ClipSafetyError) return conflict(e.message);
      throw e;
    }
  })
  // Clips of one library title: a movie has one, a show one per season.
  .get("/media/:mediaId", requireAdmin, async (c) => {
    const id = idParam.safeParse(c.req.param("mediaId"));
    if (!id.success) return badRequest("Invalid media id");
    return ok(await clipsForMedia(id.data));
  })
  .post("/:id/recut", requireAdmin, jsonV(recutBody), async (c) => {
    const id = idParam.safeParse(c.req.param("id"));
    if (!id.success) return badRequest("Invalid clip id");
    const result = await recutClip(id.data, c.req.valid("json").start_sec);
    if (result === "not_found") return notFound("Clip not found");
    if (result === "running") return conflict("Clip is being cut right now");
    if (result === "disabled") return conflict("Preview clips are off");
    return ok({ queued: true });
  });
