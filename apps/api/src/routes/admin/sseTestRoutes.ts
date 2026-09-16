import { Hono } from "hono";
import { z } from "zod";
import { ok } from "@rawkoon/api/errors";
import type { Env } from "@rawkoon/api/honoEnv";
import { jsonV } from "@rawkoon/api/middleware/validate";
import {
  emitBookUpdate,
  emitLibraryUpdate,
} from "@rawkoon/api/services/libraryEvents";

const triggerBody = z.object({
  kind: z.union([z.literal("media"), z.literal("book")]),
  id: z.number().int(),
});

/**
 * Fires a synthetic event on the real library/book SSE bus so a connected
 * client (the in-app SSE debug screen, or a manual curl) can watch delivery
 * without waiting for an actual library change. Mounted under /api/admin;
 * requireAdmin is applied at the admin parent.
 */
export const sseTestRoutes = new Hono<Env>().post(
  "/sse-test",
  jsonV(triggerBody),
  (c) => {
    const { kind, id } = c.req.valid("json");
    if (kind === "media") {
      emitLibraryUpdate(id);
    } else {
      emitBookUpdate(id);
    }
    return ok({ success: true, kind, id });
  },
);
