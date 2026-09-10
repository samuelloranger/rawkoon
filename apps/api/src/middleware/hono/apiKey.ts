import { createMiddleware } from "hono/factory";
import { unauthorized } from "@rawkoon/api/errors";
import { apiKeyApi } from "@rawkoon/api/lib/apiKeyApi";

/**
 * Hono port of `requireApiKey`. Guards a route with a better-auth API key in the
 * `x-api-key` header (used by service consumers such as Labby).
 */
export const requireApiKey = createMiddleware(async (c, next) => {
  const key = c.req.header("x-api-key");
  if (!key) return unauthorized();

  const { valid } = await apiKeyApi.verifyApiKey({ body: { key } });
  if (!valid) return unauthorized();

  await next();
});
