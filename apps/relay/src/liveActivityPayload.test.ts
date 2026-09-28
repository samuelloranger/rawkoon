import { describe, expect, test } from "bun:test";
import {
  buildLiveActivityPayload,
  liveActivityRequestSchema,
  RESULT_VISIBLE_SECS,
} from "./payload";

const token = "a".repeat(64);
const state = {
  progress: 0.46,
  step: "encode",
  etaSeconds: 3600,
  status: "running",
} as const;

describe("ActivityKit relay payload", () => {
  test("start includes the attributes type and ActivityKit content state", () => {
    const req = liveActivityRequestSchema.parse({
      event: "start",
      token,
      state,
      attributes: { jobId: 8, title: "A film", codec: "av1" },
    });
    expect(buildLiveActivityPayload(req, 123).aps).toEqual({
      timestamp: 123,
      event: "start",
      "content-state": state,
      "input-push-token": 1,
      "attributes-type": "ReencodeActivityAttributes",
      attributes: { jobId: 8, title: "A film", codec: "av1" },
      alert: { title: { "loc-key": "Re-encode started" }, body: "A film" },
    });
  });

  test("end keeps a result visible without mutable attributes", () => {
    const done = { ...state, progress: 1, status: "done" } as const;
    const req = liveActivityRequestSchema.parse({
      event: "end",
      token,
      state: done,
    });
    expect(buildLiveActivityPayload(req, 456).aps).toEqual({
      timestamp: 456,
      event: "end",
      "content-state": done,
      "dismissal-date": 456 + RESULT_VISIBLE_SECS,
    });
  });

  test("a cancelled activity is dismissed immediately", () => {
    const req = liveActivityRequestSchema.parse({
      event: "end",
      token,
      state: { ...state, status: "cancelled" },
    });
    const aps = buildLiveActivityPayload(req, 456).aps as Record<
      string,
      unknown
    >;
    expect(aps["dismissal-date"]).toBe(456);
  });

  test("rejects arbitrary APS injection and invalid progress", () => {
    expect(
      liveActivityRequestSchema.safeParse({
        event: "update",
        token,
        state: { ...state, progress: 2 },
      }).success,
    ).toBe(false);
    expect(
      liveActivityRequestSchema.safeParse({
        event: "start",
        token,
        state,
        attributes: {
          jobId: 8,
          title: "A film",
          codec: "av1",
          aps: { alert: "hijack" },
        },
      }).success,
    ).toBe(true);
    const req = liveActivityRequestSchema.parse({
      event: "start",
      token,
      state,
      attributes: {
        jobId: 8,
        title: "A film",
        codec: "av1",
        aps: { alert: "hijack" },
      },
    });
    expect(JSON.stringify(buildLiveActivityPayload(req))).not.toContain(
      "hijack",
    );
  });
});
