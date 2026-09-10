import { Hono } from "hono";
import { notFound, ok, serverError } from "@rawkoon/api/errors";
import { requireApiKey } from "@rawkoon/api/middleware/hono/apiKey";
import { buildLabbySummary } from "./summary";

// Mounted at /api/labby by the edge.
export const labbyRoutes = new Hono()
  .use("*", requireApiKey)
  .get("/summary", async () => {
    try {
      return ok(await buildLabbySummary());
    } catch (error) {
      console.error("Error building Labby summary:", error);
      return serverError("Failed to build Labby summary");
    }
  })
  .notFound(() => notFound("Not found"));
