import { describe, expect, it, mock } from "bun:test";
import { Hono } from "hono";

mock.module("@rawkoon/api/middleware/hono/auth", () => ({
  requireAdmin: async (
    c: { set: (k: string, v: unknown) => void },
    next: () => Promise<void>,
  ) => {
    c.set("user", { id: "u", is_admin: true });
    await next();
  },
  requireUser: async (_c: unknown, next: () => Promise<void>) => next(),
}));

const calls: string[] = [];
mock.module("@rawkoon/api/services/transcode/queueApi", () => ({
  enqueueSelection: async () => {
    calls.push("enqueue");
    return { batch_id: "b", count: 2, excluded: [] };
  },
  listJobs: async (s: string[]) => {
    calls.push(`list ${s.join(",")}`);
    return [];
  },
  cancelOrRemove: async (id: number) => (id === 404 ? "not_found" : "removed"),
  removeBatch: async () => 3,
  moveJob: async (id: number) => id !== 404,
  moveBatchTop: async () => 2,
  retryJob: async (id: number) => id !== 404,
  clearHistory: async () => 5,
  updateQueueSettings: async (p: object) => ({ paused: false, ...p }),
  buildSummary: async () => ({ show: false }),
}));
mock.module("@rawkoon/api/services/transcode/estimateService", () => ({
  estimateSelection: async (_s: unknown, _set: unknown, refine: boolean) => ({
    source: refine ? "refined" : "rough",
  }),
}));
mock.module("@rawkoon/api/services/transcode/capabilities", () => ({
  detectCapabilities: async () => ({
    combos: [],
    deviceLabel: null,
    vaapiUnavailableReason: "none",
    vaapiDevice: null,
  }),
}));
mock.module("@rawkoon/api/services/transcode/repo", () => ({
  loadQueueSettings: async () => ({ paused: false }),
}));

const { transcodeRoutes } = await import("@rawkoon/api/routes/transcode");
const app = new Hono().route("/api/transcode", transcodeRoutes);

const settings = {
  codec: "hevc",
  encoder: "software",
  resolution: "keep",
  mode: "quality",
  preset: "balanced",
  speed: "default",
  convertLosslessAudio: false,
};
const post = (path: string, body: unknown) =>
  app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

describe("transcode routes", () => {
  it("estimate passes the refine flag", async () => {
    const r = await post("/api/transcode/estimate", {
      selection: { file_ids: [1] },
      settings,
      refine: true,
    });
    expect(r.status).toBe(200);
    expect(((await r.json()) as { source: string }).source).toBe("refined");
  });

  it("estimate rejects invalid settings", async () => {
    const r = await post("/api/transcode/estimate", {
      selection: { file_ids: [1] },
      settings: { ...settings, codec: "vp9" },
    });
    expect(r.status).toBe(400);
  });

  it("enqueue returns the batch", async () => {
    const r = await post("/api/transcode/jobs", {
      selection: { media_id: 1 },
      settings,
    });
    expect(await r.json()).toEqual({ batch_id: "b", count: 2, excluded: [] });
  });

  it("lists queued jobs by default", async () => {
    await app.request("/api/transcode/jobs");
    expect(calls).toContain("list queued,running");
  });

  it("404s unknown jobs on delete, move and retry", async () => {
    expect(
      (await app.request("/api/transcode/jobs/404", { method: "DELETE" }))
        .status,
    ).toBe(404);
    expect(
      (await post("/api/transcode/jobs/404/move", { top: true })).status,
    ).toBe(404);
    expect((await post("/api/transcode/jobs/404/retry", {})).status).toBe(404);
  });

  it("patches settings", async () => {
    const r = await app.request("/api/transcode/settings", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ paused: true }),
    });
    expect(((await r.json()) as { paused: boolean }).paused).toBe(true);
  });

  it("rejects a malformed window time", async () => {
    const r = await app.request("/api/transcode/settings", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ window_start: "25:00" }),
    });
    expect(r.status).toBe(400);
  });
});
