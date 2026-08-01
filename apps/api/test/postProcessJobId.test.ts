import { describe, it, expect } from "bun:test";

import { postProcessJobId } from "@rawkoon/api/services/downloadOutcome";

// BullMQ reserves ':' as its key separator and validates custom job ids in
// Job.addJob. An id it rejects makes every enqueue throw at runtime — and
// because completion has already stamped completedAt by then, the reconcile
// loop never revisits the row and the file never reaches the library.
//
// Asserting the rule here rather than through a stubbed addJob, which is what
// let a colon-separated id ship in the first place.
describe("postProcessJobId", () => {
  // Mirrors bullmq/dist/cjs/classes/job.js — a custom id may not be an integer,
  // and may not contain ':' unless it happens to have exactly three segments
  // (a compatibility carve-out for repeatable jobs, not a rule to lean on).
  function bullmqRejects(jobId: string): string | null {
    if (`${parseInt(jobId, 10)}` === jobId)
      return "Custom Id cannot be integers";
    if (jobId.includes(":") && jobId.split(":").length !== 3) {
      return "Custom Id cannot contain :";
    }
    return null;
  }

  it("produces an id BullMQ accepts", () => {
    expect(bullmqRejects(postProcessJobId(42))).toBeNull();
  });

  it("produces a forced id BullMQ accepts", () => {
    expect(
      bullmqRejects(postProcessJobId(42, { force: true, nowMs: 1_700_000 })),
    ).toBeNull();
  });

  it("never emits a colon", () => {
    expect(postProcessJobId(42)).not.toContain(":");
    expect(postProcessJobId(42, { force: true })).not.toContain(":");
  });

  it("is stable per row so a pending run is not queued twice", () => {
    expect(postProcessJobId(42)).toBe(postProcessJobId(42));
    expect(postProcessJobId(42)).not.toBe(postProcessJobId(43));
  });

  it("is unique per call when forced, so recovery always runs", () => {
    const first = postProcessJobId(42, { force: true, nowMs: 1 });
    const second = postProcessJobId(42, { force: true, nowMs: 2 });
    expect(first).not.toBe(second);
    expect(first).not.toBe(postProcessJobId(42));
  });
});
