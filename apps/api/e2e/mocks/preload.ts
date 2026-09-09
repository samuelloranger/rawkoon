// bun --preload target: installs external mocks BEFORE the app is imported by
// server.ts / genManifest.ts, so route modules close over the stubs.
import { installExternalMocks } from "./externals";

installExternalMocks();
