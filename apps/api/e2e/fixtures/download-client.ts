import type { FixtureRegistry } from "./types";

export const downloadClientFixtures: FixtureRegistry = {
  "POST /api/download-client/hook/complete": {
    phase: "action",
    skipReason:
      "Webhook requires an X-Rawkoon-Token header (hook token); the e2e harness cannot attach custom headers, so it can't reach the 202 path deterministically.",
  },
};
