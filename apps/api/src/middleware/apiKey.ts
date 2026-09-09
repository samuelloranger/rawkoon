import { Elysia } from "elysia";
import { unauthorized } from "@rawkoon/api/errors";
import { apiKeyApi } from "@rawkoon/api/lib/apiKeyApi";

/**
 * Guards a route with a better-auth API key supplied via the `x-api-key` header.
 * Used by service consumers (e.g. Labby).
 */
export const requireApiKey = (app: Elysia) =>
  app.onBeforeHandle(async ({ request }) => {
    const key = request.headers.get("x-api-key");
    if (!key) return unauthorized();

    const { valid } = await apiKeyApi.verifyApiKey({ body: { key } });
    if (!valid) return unauthorized();
  });
