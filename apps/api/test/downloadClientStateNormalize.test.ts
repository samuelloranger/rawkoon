import { describe, expect, it } from "bun:test";
import {
  normalizeDelugeState,
  normalizeQbState,
  normalizeTransmissionState,
} from "@rawkoon/api/services/downloadClient/stateNormalize";

describe("normalizeQbState", () => {
  it("maps completed states", () => {
    for (const state of [
      "uploading",
      "pausedUP",
      "stoppedUP",
      "stalledUP",
      "queuedUP",
      "forcedUP",
    ]) {
      expect(normalizeQbState(state)).toBe("completed");
    }
  });

  it("maps errors, stalls, and pauses", () => {
    expect(normalizeQbState("error")).toBe("error");
    expect(normalizeQbState("missingFiles")).toBe("error");
    expect(normalizeQbState("stalledDL")).toBe("stalled");
    expect(normalizeQbState("pausedDL")).toBe("paused");
    expect(normalizeQbState("stoppedDL")).toBe("paused");
  });

  it("defaults to downloading", () => {
    expect(normalizeQbState("downloading")).toBe("downloading");
    expect(normalizeQbState("metaDL")).toBe("downloading");
  });
});

describe("normalizeTransmissionState", () => {
  it("maps completed and paused states from status and progress", () => {
    expect(normalizeTransmissionState(6, { percentDone: 1 })).toBe("completed");
    expect(normalizeTransmissionState(5, { percentDone: 1 })).toBe("completed");
    expect(normalizeTransmissionState(0, { percentDone: 1 })).toBe("completed");
    expect(normalizeTransmissionState(0, { percentDone: 0.4 })).toBe("paused");
  });

  it("lets error and stalled flags win", () => {
    expect(
      normalizeTransmissionState(4, { percentDone: 0.2, errorNo: 3 }),
    ).toBe("error");
    expect(
      normalizeTransmissionState(4, { percentDone: 0.2, isStalled: true }),
    ).toBe("stalled");
  });

  it("defaults active transfers to downloading", () => {
    expect(normalizeTransmissionState(4, { percentDone: 0.2 })).toBe(
      "downloading",
    );
  });
});

describe("normalizeDelugeState", () => {
  it("maps terminal and paused states", () => {
    expect(normalizeDelugeState("Seeding")).toBe("completed");
    expect(normalizeDelugeState("Error")).toBe("error");
    expect(normalizeDelugeState("Paused")).toBe("paused");
  });

  it("defaults active states to downloading", () => {
    expect(normalizeDelugeState("Downloading")).toBe("downloading");
    expect(normalizeDelugeState("Queued")).toBe("downloading");
    expect(normalizeDelugeState("Checking")).toBe("downloading");
  });
});
