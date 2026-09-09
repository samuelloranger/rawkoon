// bun --preload target: installs external mocks BEFORE the app is imported by
// server.ts / genManifest.ts, so route modules close over the stubs.
import { installExternalMocks } from "./externals";

// better-auth 1.7.3's schema check doesn't resolve Prisma @@map and would 500 all
// auth against a real DB; disable it for the harness (prod keeps it on).
process.env.BETTER_AUTH_DISABLE_SCHEMA_CHECK = "1";

installExternalMocks();
