import { describe, it, expect } from "bun:test";

import { selectActiveCadenceSecs } from "@rawkoon/api/workers/checkDownloadCompletion";

describe("selectActiveCadenceSecs", () => {
  const nowMs = 1_800_000_000_000;
  const base = { nowMs, activeSecs: 20, hookedActiveSecs: 120 };

  it("uses the fast cadence when no hook has ever been received", () => {
    expect(selectActiveCadenceSecs({ ...base, hookLastSeenAt: null })).toBe(20);
  });

  it("uses the slow cadence when a hook arrived recently", () => {
    expect(
      selectActiveCadenceSecs({
        ...base,
        hookLastSeenAt: new Date(nowMs - 60_000),
      }),
    ).toBe(120);
  });

  it("falls back to the fast cadence once the hook goes quiet for a day", () => {
    expect(
      selectActiveCadenceSecs({
        ...base,
        hookLastSeenAt: new Date(nowMs - 25 * 60 * 60 * 1000),
      }),
    ).toBe(20);
  });

  it("treats a hook exactly at the window edge as stale", () => {
    expect(
      selectActiveCadenceSecs({
        ...base,
        hookLastSeenAt: new Date(nowMs - 24 * 60 * 60 * 1000),
      }),
    ).toBe(20);
  });
});

// Regression: the scheduled worker runs at concurrency 3 and a pass can now be
// triggered by the cron tick and by each hook wake. Two overlapping passes read
// the same pending snapshot; the first completes a row and the second then hits
// completeDownloadByHash's already-complete recovery branch, which enqueues
// post-processing with `force` — a unique job id that bypasses BullMQ's dedupe.
// The same download would be imported twice.
describe("runCoalescedPass", () => {
  it("joins an in-flight pass instead of starting a second one", async () => {
    const { runCoalescedPass } = await import(
      "@rawkoon/api/workers/checkDownloadCompletion"
    );
    let starts = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const pass = () => {
      starts++;
      return gate;
    };

    const a = runCoalescedPass(pass);
    const b = runCoalescedPass(pass);
    const c = runCoalescedPass(pass);
    expect(starts).toBe(1);

    release();
    await Promise.all([a, b, c]);
    expect(starts).toBe(1);
  });

  it("allows a new pass once the previous one settles", async () => {
    const { runCoalescedPass } = await import(
      "@rawkoon/api/workers/checkDownloadCompletion"
    );
    let starts = 0;
    const pass = () => {
      starts++;
      return Promise.resolve();
    };
    await runCoalescedPass(pass);
    await runCoalescedPass(pass);
    expect(starts).toBe(2);
  });

  it("clears the in-flight slot when a pass throws", async () => {
    const { runCoalescedPass } = await import(
      "@rawkoon/api/workers/checkDownloadCompletion"
    );
    await expect(
      runCoalescedPass(() => Promise.reject(new Error("boom"))),
    ).rejects.toThrow("boom");
    // A rejection must not wedge the guard shut forever.
    let ran = false;
    await runCoalescedPass(() => {
      ran = true;
      return Promise.resolve();
    });
    expect(ran).toBe(true);
  });
});
