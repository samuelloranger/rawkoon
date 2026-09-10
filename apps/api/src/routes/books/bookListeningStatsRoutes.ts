import { Hono } from "hono";
import { ok } from "@rawkoon/api/errors";
import type { Env } from "@rawkoon/api/honoEnv";
import { requireUser } from "@rawkoon/api/middleware/hono/auth";
import { getListeningStats } from "@rawkoon/api/services/books/listeningStats";

export const bookListeningStatsRoutes = new Hono<Env>().get(
  "/listening-stats",
  requireUser,
  async (c) => ok(await getListeningStats(c.get("user").id)),
);
