import { beforeEach, describe, expect, it, mock } from "bun:test";

let media: { id: number; type: string; status: string } | null = null;
const grabRelease = mock(async () => ({
  grabbed: true as boolean,
  releaseTitle: "New.Release.2160p",
  reason: "",
}));
type Prep =
  | { status: "already_active" }
  | { status: "cancelled"; cancelled: number }
  | { status: "refused"; reason: string; stopped: number };
const cancelActiveMovieDownloads = mock(
  async (..._args: unknown[]): Promise<Prep> => ({
    status: "cancelled",
    cancelled: 1,
  }),
);
let preflight: { refusal: { grabbed: false; reason: string } } | object = {};
const preflightGrab = mock(async (..._args: unknown[]) => preflight);

mock.module("@rawkoon/api/db", () => ({
  prisma: {
    libraryMedia: { findUnique: async () => media },
    libraryEpisode: { findFirst: async () => null, findMany: async () => [] },
  },
}));
mock.module("@rawkoon/api/middleware/hono/auth", () => ({
  requireAdmin: async (_c: unknown, next: () => Promise<void>) => next(),
}));
mock.module("@rawkoon/api/services/mediaGrabber/mediaGrabberGrab", () => ({
  grabRelease,
  preflightGrab,
}));
mock.module("@rawkoon/api/services/replaceActiveDownload", () => ({
  cancelActiveMovieDownloads,
}));

const { libraryGrabRoutes } = await import("./libraryGrabRoutes");

const grab = (extra: Record<string, unknown> = {}) =>
  libraryGrabRoutes.request("/1/grab", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      download_url: "magnet:?xt=urn:btih:abc",
      release_title: "New.Release.2160p",
      ...extra,
    }),
  });

describe("POST /:id/grab replace", () => {
  beforeEach(() => {
    media = { id: 1, type: "movie", status: "downloading" };
    grabRelease.mockClear();
    cancelActiveMovieDownloads.mockClear();
    preflightGrab.mockClear();
    preflight = {};
    cancelActiveMovieDownloads.mockImplementation(async () => ({
      status: "cancelled",
      cancelled: 1,
    }));
    grabRelease.mockImplementation(async () => ({
      grabbed: true,
      releaseTitle: "New.Release.2160p",
      reason: "",
    }));
  });

  it("refuses a downloading movie without the flag", async () => {
    const res = await grab();
    expect(res.status).toBe(400);
    expect(cancelActiveMovieDownloads).not.toHaveBeenCalled();
    expect(grabRelease).not.toHaveBeenCalled();
  });

  it("stops the running download, then grabs, when replace is set", async () => {
    const res = await grab({ replace: true });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      grabbed: true,
      release_title: "New.Release.2160p",
    });
    expect(cancelActiveMovieDownloads).toHaveBeenCalledTimes(1);
    expect(grabRelease).toHaveBeenCalledTimes(1);
  });

  it("reports that the old download is gone when the new grab fails", async () => {
    grabRelease.mockImplementation(async () => ({
      grabbed: false,
      releaseTitle: "",
      reason: "Blocklisted: bad release",
    }));
    const res = await grab({ replace: true });
    expect(await res.json()).toEqual({
      grabbed: false,
      reason: "Blocklisted: bad release",
      replaced_previous: true,
    });
  });

  it("does not cancel anything for a movie that is not downloading", async () => {
    media = { id: 1, type: "movie", status: "wanted" };
    const res = await grab({ replace: true });
    expect(res.status).toBe(200);
    expect(cancelActiveMovieDownloads).not.toHaveBeenCalled();
  });

  it("rejects replace on a show", async () => {
    media = { id: 1, type: "show", status: "wanted" };
    const res = await grab({ replace: true });
    expect(res.status).toBe(400);
  });

  it("leaves the running download alone when preflight refuses", async () => {
    preflight = {
      refusal: { grabbed: false, reason: "Blocklisted: bad release" },
    };
    const res = await grab({ replace: true });
    expect(await res.json()).toEqual({
      grabbed: false,
      reason: "Blocklisted: bad release",
    });
    expect(cancelActiveMovieDownloads).not.toHaveBeenCalled();
    expect(grabRelease).not.toHaveBeenCalled();
  });

  it("succeeds without grabbing when the running download is that release", async () => {
    cancelActiveMovieDownloads.mockImplementation(async () => ({
      status: "already_active",
    }));
    const res = await grab({ replace: true });
    expect(await res.json()).toEqual({
      grabbed: true,
      release_title: "New.Release.2160p",
    });
    expect(grabRelease).not.toHaveBeenCalled();
  });

  it("refuses without grabbing when the old download could not be stopped", async () => {
    cancelActiveMovieDownloads.mockImplementation(async () => ({
      status: "refused",
      reason: "The download finished or changed while replacing it",
      stopped: 0,
    }));
    const res = await grab({ replace: true });
    expect(await res.json()).toEqual({
      grabbed: false,
      reason: "The download finished or changed while replacing it",
    });
    expect(grabRelease).not.toHaveBeenCalled();
  });

  it("still reports the old download gone when the grab throws", async () => {
    grabRelease.mockImplementation(async () => {
      throw new Error("boom");
    });
    const res = await grab({ replace: true });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      grabbed: false,
      reason: "Grab failed",
      replaced_previous: true,
    });
  });

  it("reports a partial stop when some torrents were already removed", async () => {
    cancelActiveMovieDownloads.mockImplementation(async () => ({
      status: "refused",
      reason: "Could not stop the running download: client down",
      stopped: 1,
    }));
    const res = await grab({ replace: true });
    expect(await res.json()).toEqual({
      grabbed: false,
      reason: "Could not stop the running download: client down",
      replaced_previous: true,
    });
  });
});
