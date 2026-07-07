import { Elysia } from "elysia";
import { requireApiKey } from "@rawkoon/api/middleware/apiKey";
import { serverError } from "@rawkoon/api/errors";
import { buildLabbySummary } from "./summary";

export const labbyRoutes = new Elysia({ prefix: "/api/labby" })
  .use(requireApiKey)
  .get("/summary", async ({ set }) => {
    try {
      return await buildLabbySummary();
    } catch (error) {
      console.error("Error building Labby summary:", error);
      return serverError(set, "Failed to build Labby summary");
    }
  });
