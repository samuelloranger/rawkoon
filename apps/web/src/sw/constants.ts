/**
 * Runtime cache name, per build.
 *
 * This used to be a fixed string. The worker serves hashed assets cache-first,
 * so a cache that outlived its build kept devices on a superseded bundle — one
 * phone ran three releases behind and never executed the fixes it had been
 * given. `activate-handler` deletes every cache but the current one and the
 * book cache, so tying the name to the build is what makes a release land.
 */
export const CACHE_VERSION = `rawkoon-${__BUILD_ID__}`;
