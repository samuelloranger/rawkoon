import type { FixtureRegistry } from "./types";

// calendar: the subscription routes need a session; the .ics feed is public and
// authenticates by the token in its file name.
function captureFeed(body: unknown, ctx: { set(k: string, v: string): void }) {
  const url = (body as { url?: unknown }).url;
  if (typeof url === "string")
    ctx.set("calendarFile", url.split("/").pop() ?? "");
}

export const calendarFixtures: FixtureRegistry = {
  // Bootstrap so the feed token exists before the read phase reaches /:file.
  "GET /api/calendar/subscription": {
    phase: "bootstrap",
    negativeBody: null,
    captures: captureFeed,
  },
  "GET /api/calendar/:file": {
    phase: "read",
    public: true,
    pathParams: (ctx) => ({ file: ctx.get("calendarFile") }),
    negativeBody: null,
  },
  "POST /api/calendar/subscription/regenerate": {
    phase: "action",
    negativeBody: null,
  },
};
