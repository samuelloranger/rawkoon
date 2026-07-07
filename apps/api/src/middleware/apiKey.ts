import { Elysia } from "elysia";
import { apiKeyApi } from "@rawkoon/api/lib/apiKeyApi";

/**
 * Guards a route with a better-auth API key supplied via the `x-api-key` header.
 * Used by service consumers (e.g. Labby).
 */
export const requireApiKey = (app: Elysia) =>
  app.onBeforeHandle(async ({ request, set }) => {
    const key = request.headers.get("x-api-key");
    if (!key) {
      set.status = 401;
      return { error: "Unauthorized" };
    }

    const { valid } = await apiKeyApi.verifyApiKey({ body: { key } });
    if (!valid) {
      set.status = 401;
      return { error: "Unauthorized" };
    }
  });
