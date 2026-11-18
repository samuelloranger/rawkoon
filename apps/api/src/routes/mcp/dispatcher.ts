import type { MappedUser } from "@rawkoon/api/honoEnv";
import { actAs } from "@rawkoon/api/middleware/auth";

/**
 * Tools dispatch in-process through the Hono app so every existing guard,
 * validator and permission check applies. `src/index.ts` owns the app, and
 * importing it from here would be a cycle, so it injects `app.fetch` after the
 * app is built (tests inject their own dispatch target the same way).
 */
type Dispatcher = (request: Request) => Response | Promise<Response>;

let dispatcher: Dispatcher | null = null;

export function setMcpDispatcher(fn: Dispatcher): void {
  dispatcher = fn;
}

// The host is irrelevant in-process; only the path reaches the router.
const INNER_BASE_URL = "http://localhost";

export function innerRequest(path: string, init?: RequestInit): Request {
  return new Request(`${INNER_BASE_URL}${path}`, init);
}

/**
 * Dispatches a Request as the key owner: actAs seeds the identity memo for
 * this exact Request object, so requireUser/requireAdmin resolve the owner
 * without any session credential on the inner request.
 */
export async function dispatchAsUser(
  request: Request,
  user: MappedUser,
): Promise<Response> {
  if (!dispatcher) {
    throw new Error("MCP dispatcher is not configured (setMcpDispatcher)");
  }
  actAs(request, user);
  return Promise.resolve(dispatcher(request));
}

export function innerJson(path: string, body: unknown): Request {
  return innerRequest(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
