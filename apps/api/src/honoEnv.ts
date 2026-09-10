import { createFactory } from "hono/factory";
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
