import { describe, expect, it } from "bun:test";
import { Elysia } from "elysia";
import { buildLabbySummary } from "./summary";

const { labbyRoutes } = await import("./index");
const app = new Elysia().use(labbyRoutes);

describe("Labby API", () => {
  it("rejects a missing api key", async () => {
    const res = await app.handle(
      new Request("http://localhost/api/labby/summary"),
    );
    expect(res.status).toBe(401);
  });

  it("builds summary from injected dependencies", async () => {
    const summary = await buildLabbySummary({
      getUpcoming: async () => [
        {
          id: "movie:1",
          title: "Movie",
          date: "2026-07-01",
          posterUrl: undefined,
        },
      ],
      getLastRssRun: async () => ({
        status: "success",
        releases_found: 4,
        releases_grabbed: 2,
        releases_grabbed_by_ai: 1,
        indexers: [],
        started_at: "2026-06-16T00:00:00Z",
        completed_at: "2026-06-16T00:01:00Z",
        error: null,
      }),
    });

    expect(summary.upcoming[0].title).toBe("Movie");
    expect(summary.rss).toMatchObject({
      status: "ok",
      releasesFound: 4,
      releasesGrabbed: 2,
    });
  });
});
