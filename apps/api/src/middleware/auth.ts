import { Elysia } from "elysia";
import { auth as betterAuth } from "@rawkoon/api/lib/auth";
import { prisma } from "@rawkoon/api/db";
import { mapUser } from "@rawkoon/api/utils/mappers";

export const resolveUser = async (request: Request) => {
  const session = await betterAuth.api.getSession({ headers: request.headers });
  if (!session) return null;

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
  });
  return user ? mapUser(user) : null;
};

export const requireUser = (app: Elysia) =>
  app
    .resolve(async ({ request }) => ({ user: await resolveUser(request) }))
    .onBeforeHandle(({ user, set }) => {
      if (!user) {
        set.status = 401;
        return { error: "Unauthorized" };
      }
    });

// Re-exported so routes can keep importing it from "@rawkoon/api/middleware/auth".
export { ensureAdmin } from "@rawkoon/api/middleware/ensureAdmin";

export const requireAdmin = (app: Elysia) =>
  app
    .resolve(async ({ request }) => ({ user: await resolveUser(request) }))
    .onBeforeHandle(({ user, set }) => {
      if (!user) {
        set.status = 401;
        return { error: "Unauthorized" };
      }
      if (!user.is_admin) {
        set.status = 403;
        return { error: "Forbidden" };
      }
    });
