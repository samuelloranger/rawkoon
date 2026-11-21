import type { Context } from "hono";
import { createFactory } from "hono/factory";
import { HTTPException } from "hono/http-exception";
import { errorForStatus, notFound, serverError } from "@rawkoon/api/errors";
import type { mapUser } from "@rawkoon/api/utils/mappers";

/** The app user shape carried on the Hono context after an auth guard runs. */
export type MappedUser = ReturnType<typeof mapUser>;

/**
 * Hono environment for the whole app. `user` is set by `requireUser` /
 * `requireAdmin` (see middleware/auth), so guarded handlers read a non-null
 * user via `c.get("user")`. Public handlers resolve the user directly instead.
 */
export type Env = {
  Variables: {
    user: MappedUser;
  };
};

export const factory = createFactory<Env>();

/**
 * Shared onError for the routers. A mounted Hono app catches its own throws,
 * so give each router this handler. Client faults (HTTPException 4xx, e.g.
 * malformed JSON) keep their message; anything else is a neutral 500 so an
 * internal message never leaks.
 */
export const honoOnError = (err: Error, _c: Context): Response => {
  if (err instanceof HTTPException && err.status < 500) {
    return errorForStatus(err.status, err.message);
  }
  // Duck-typed: a Prisma "record not found" that a handler let bubble.
  if ((err as { code?: unknown }).code === "P2025") {
    return notFound("Not found");
  }
  console.error("[unhandled]", err);
  return serverError("Internal server error");
};
