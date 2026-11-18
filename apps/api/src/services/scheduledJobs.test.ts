import { describe, expect, it } from "bun:test";
import { DEFAULT_RELEASE_CHECK_CRON } from "@rawkoon/shared/utils";
import { buildScheduledJobs } from "./scheduledJobs";

// Literals, per the module comment: importing SCHEDULED_JOB_NAMES at runtime
// would drag the preloaded queueService stub into this test.
const ON_DEMAND_JOB_NAMES = ["search-on-add", "upgrade-media-search"] as const;

describe("buildScheduledJobs", () => {
  const jobs = buildScheduledJobs();
  const names = jobs.map((job) => job.name);

  it("registers a fixed, unique set of scheduler names", () => {
    // Pin the count: adding or removing a scheduler is a deliberate change to
    // what startup (and the doctor) expects.
    expect(names).toHaveLength(19);
    expect(new Set(names).size).toBe(names.length);
  });

  it("does not expect the on-demand jobs", () => {
    // search-on-add and upgrade-media-search are enqueued per title by the
    // grab/search paths — no scheduler ever exists for them, so the doctor
    // must never warn about them on a healthy instance.
    for (const name of ON_DEMAND_JOB_NAMES) {
      expect(names).not.toContain(name);
    }
  });

  it("uses the caller's settings-driven patterns", () => {
    const byName = new Map(
      buildScheduledJobs({
        releaseCheckCron: "27 */3 * * *",
        rssPollPattern: "7-59/30 * * * *",
      }).map((job) => [job.name, job.pattern]),
    );
    expect(byName.get("check-library-movie-releases")).toBe("27 */3 * * *");
    expect(byName.get("check-library-episode-releases")).toBe("27 */3 * * *");
    expect(byName.get("poll-indexer-rss")).toBe("7-59/30 * * * *");
  });

  it("defaults the settings-driven patterns for the doctor's bare call", () => {
    const byName = new Map(jobs.map((job) => [job.name, job.pattern]));
    expect(byName.get("check-library-movie-releases")).toBe(
      DEFAULT_RELEASE_CHECK_CRON,
    );
  });
});
