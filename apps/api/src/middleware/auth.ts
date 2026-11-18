import { auth as betterAuth } from "@rawkoon/api/lib/auth";
import { prisma } from "@rawkoon/api/db";
import type { MappedUser } from "@rawkoon/api/honoEnv";
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

const users = new WeakMap<
  Request,
  Promise<ReturnType<typeof mapUser> | null>
>();

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

/**
 * In-process dispatches (the MCP tool layer): marked so middleware can tell
 * them apart from real external requests. Object-identity keyed, so an
 * incoming request — which always gets its own Request — can never be marked.
 */
const innerRequests = new WeakSet<Request>();

export function markInnerRequest(request: Request): void {
  innerRequests.add(request);
}

export function isInnerRequest(request: Request): boolean {
  return innerRequests.has(request);
}

/**
 * Seeds the per-request identity memos for one exact Request object, so the
 * guards (requireUser/requireAdmin) resolve the given user with no session
 * lookup, and marks it as an in-process dispatch. Server-internal only: a
 * WeakMap/WeakSet keyed by object identity can't be reached by an incoming
 * request, which always builds its own Request.
 */
export function actAs(request: Request, user: MappedUser): void {
  // Only the memo's non-nullness is consumed, by getRequestSession callers;
  // the guards read the user via resolveUser above. The global rate limiter
  // does not consult it — credential-less requests never reach the session
  // check — and instead skips via the inner-request mark above.
  sessions.set(
    request,
    Promise.resolve({ user: { id: user.id } } as unknown as Awaited<
      ReturnType<typeof betterAuth.api.getSession>
    >),
  );
  users.set(request, Promise.resolve(user));
  markInnerRequest(request);
}
