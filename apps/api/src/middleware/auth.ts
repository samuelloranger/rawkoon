import { auth as betterAuth } from "@rawkoon/api/lib/auth";
import { prisma } from "@rawkoon/api/db";
import { mapUser } from "@rawkoon/api/utils/mappers";

// Per-request memo so the rate limiter and the guards share one session lookup.
const sessions = new WeakMap<
  Request,
  ReturnType<typeof betterAuth.api.getSession>
>();
export function getRequestSession(request: Request) {
  let s = sessions.get(request);
  if (!s) {
    s = betterAuth.api.getSession({ headers: request.headers });
    sessions.set(request, s);
  }
  return s;
}

const users = new WeakMap<Request, Promise<ReturnType<typeof mapUser> | null>>();

// Framework-neutral session resolver, shared by the Hono guards
// (middleware/hono/auth) and the routes that populate a user directly.
export const resolveUser = (request: Request) => {
  let u = users.get(request);
  if (!u) {
    u = lookupUser(request);
    users.set(request, u);
  }
  return u;
};

async function lookupUser(request: Request) {
  const session = await getRequestSession(request);
  if (!session) return null;

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
  });
  return user ? mapUser(user) : null;
}
