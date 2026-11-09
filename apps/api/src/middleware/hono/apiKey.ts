import { createMiddleware } from "hono/factory";
import { prisma } from "@rawkoon/api/db";
import { unauthorized } from "@rawkoon/api/errors";
import { apiKeyApi } from "@rawkoon/api/lib/apiKeyApi";

/**
 * Hono port of `requireApiKey`. Guards a route with a better-auth API key in the
 * `x-api-key` header (used by service consumers such as Labby). The key must
 * belong to an administrator.
 */
export const requireApiKey = createMiddleware(async (c, next) => {
  const key = c.req.header("x-api-key");
  if (!key) return unauthorized();

  const { valid, key: record } = await apiKeyApi.verifyApiKey({
    body: { key },
  });
  if (!valid || !record) return unauthorized();

  const owner = await prisma.user.findUnique({
    where: { id: record.referenceId },
    select: { isAdmin: true },
  });
  if (!owner?.isAdmin) return unauthorized();

  await next();
});
