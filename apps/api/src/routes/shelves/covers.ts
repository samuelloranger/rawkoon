import { Hono } from "hono";
import { notFound } from "@rawkoon/api/errors";
import type { Env } from "@rawkoon/api/honoEnv";
import { readShelfCover } from "@rawkoon/api/services/shelves/shelfCoverService";

// Mounted at /api/shelves/covers, before the shelves router: an uploaded cover
// is drawn by the TV and the phones with no token, so this route has no guard.
export const shelfCoverRoutes = new Hono<Env>().get("/:filename", async (c) => {
  const cover = await readShelfCover(c.req.param("filename"));
  if (!cover) return notFound("Cover not found");
  return new Response(new Uint8Array(cover.body), {
    headers: {
      "Content-Type": cover.contentType,
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
});
