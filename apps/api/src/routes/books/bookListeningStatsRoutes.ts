import { Elysia } from "elysia";
import { requireUser } from "@rawkoon/api/middleware/auth";
import { getListeningStats } from "@rawkoon/api/services/books/listeningStats";

export const bookListeningStatsRoutes = new Elysia()
  .use(requireUser)
  .get("/listening-stats", async ({ user }) => getListeningStats(user!.id));
