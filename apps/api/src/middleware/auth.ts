import { auth as betterAuth } from "@rawkoon/api/lib/auth";
import { prisma } from "@rawkoon/api/db";
import { mapUser } from "@rawkoon/api/utils/mappers";

// Framework-neutral session resolver, shared by the Hono guards
// (middleware/hono/auth) and the routes that populate a user directly.
export const resolveUser = async (request: Request) => {
  const session = await betterAuth.api.getSession({ headers: request.headers });
  if (!session) return null;

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
  });
  return user ? mapUser(user) : null;
};

// Re-exported so routes can keep importing it from "@rawkoon/api/middleware/auth".
export { ensureAdmin } from "@rawkoon/api/middleware/ensureAdmin";
