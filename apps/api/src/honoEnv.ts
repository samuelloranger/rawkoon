import type { Context } from "hono";
import { createFactory } from "hono/factory";
import { serverError } from "@rawkoon/api/errors";
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
 * Shared onError for ported routers. Elysia's global onError swallowed any
 * uncaught throw into a 500 `{ error: "Internal server error" }`; a mounted Hono
 * app catches its own throws, so give each router this handler to keep that
 * exact contract (never leak an internal message to the client).
 */
export const honoOnError = (err: Error, _c: Context): Response => {
  console.error("[unhandled]", err);
  return serverError("Internal server error");
};
