import { Elysia, t } from "elysia";

import { serverError } from "@rawkoon/api/errors";
import { requireAdmin } from "@rawkoon/api/middleware/auth";
import { assignDownloadFromDisk } from "@rawkoon/api/services/downloadsAssign";
import { scanDownloads } from "@rawkoon/api/services/downloadsScanner";

function mapParsed(
  p: import("@rawkoon/api/services/downloadsScanner").RawDownloadRow["parsed"],
) {
  return {
    title: p.title,
    year: p.year,
    season: p.season,
    episode: p.episode,
    quality: p.quality,
    codec: p.codec,
    release_group: p.release_group,
    hdr: p.hdr,
    audio: p.audio,
    subtitles: p.subtitles,
    kind: p.kind,
  };
}

/** Admin imports from configured Downloads dirs (see Downloads Import UI). */
export const libraryDownloadsRoutes = new Elysia({
  prefix: "/api/library/downloads",
})
  .use(requireAdmin)
  .get(
    "/list",
    async ({ query, set }) => {
      try {
        const refresh = query.refresh === "1" || query.refresh === "true";
        const scan = await scanDownloads({ refresh });
        return {
          file_operation: scan.file_operation,
          items: scan.entries.map((r) => ({
            file_path: r.file_path,
            file_name: r.file_name,
            size_bytes: r.size_bytes,
            modified_at: r.modified_at,
            dev: r.dev,
            ino: r.ino,
            is_imported: r.is_imported,
            parsed: mapParsed(r.parsed),
          })),
        };
      } catch (e) {
        console.warn("[downloads/list]", e);
        return serverError(set, "Failed to scan downloads folders");
      }
    },
    {
      query: t.Object({
        refresh: t.Optional(t.String()),
      }),
    },
  )
  .post(
    "/assign",
    async ({ body, set }) => {
      try {
        const result = await assignDownloadFromDisk({
          file_path: body.file_path,
          tmdb_id: body.tmdb_id,
          kind: body.kind,
          season: body.season,
          episode: body.episode,
        });

        if ("error" in result && "status" in result) {
          set.status = result.status;
          return { error: result.error };
        }

        const ok = result as {
          library_media_id: number;
          media_file_id: number;
        };
        return {
          library_media_id: ok.library_media_id,
          media_file_id: ok.media_file_id,
        };
      } catch (e) {
        console.warn("[downloads/assign]", e);
        return serverError(set, "Failed to assign download");
      }
    },
    {
      body: t.Object({
        file_path: t.String({ maxLength: 8192 }),
        tmdb_id: t.Number({ minimum: 1 }),
        kind: t.Union([t.Literal("movie"), t.Literal("tv")]),
        season: t.Optional(t.Integer({ minimum: 0 })),
        episode: t.Optional(t.Integer({ minimum: 0 })),
      }),
    },
  );
