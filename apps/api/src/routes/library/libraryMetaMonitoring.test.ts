import { beforeEach, describe, expect, it, mock } from "bun:test";

// Unmonitoring or settling the last missing episode can complete a show request.

const recheck = mock(async (_mediaId: number) => {});

mock.module("@rawkoon/api/middleware/hono/auth", () => ({
  requireAdmin: async (_c: unknown, next: () => Promise<void>) => next(),
  requireUser: async (_c: unknown, next: () => Promise<void>) => next(),
}));
const realMutations = await import(
  "@rawkoon/api/services/library/libraryMetaMutations"
);
mock.module("@rawkoon/api/services/library/libraryMetaMutations", () => ({
  ...realMutations,
  setSeasonMonitored: async () => 3,
  setEpisodeMonitored: async () => ({ id: 9, monitored: false }),
  setEpisodeStatus: async () => ({
    id: 9,
    status: "downloaded",
    searchAttempts: 0,
  }),
}));
const realNotifications = await import(
  "@rawkoon/api/services/mediaRequestNotifications"
);
mock.module("@rawkoon/api/services/mediaRequestNotifications", () => ({
  ...realNotifications,
  recheckRequestAvailable: recheck,
}));

const { libraryMetaRoutes } = await import("./libraryMetaRoutes");

const patch = (path: string, body: unknown) =>
  libraryMetaRoutes.request(`http://localhost${path}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

describe("episode and season edits re-check the show's request", () => {
  beforeEach(() => recheck.mockClear());

  it("after a season's monitoring changes", async () => {
    const res = await patch("/1/seasons/2/monitored", { monitored: false });
    expect(res.status).toBe(200);
    expect(recheck.mock.calls).toEqual([[1]]);
  });

  it("after an episode's monitoring changes", async () => {
    const res = await patch("/1/episodes/9/monitored", { monitored: false });
    expect(res.status).toBe(200);
    expect(recheck.mock.calls).toEqual([[1]]);
  });

  it("after an episode's status changes", async () => {
    const res = await patch("/1/episodes/9/status", { status: "downloaded" });
    expect(res.status).toBe(200);
    expect(recheck.mock.calls).toEqual([[1]]);
  });
});
