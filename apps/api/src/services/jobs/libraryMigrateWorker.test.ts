import { describe, expect, it } from "bun:test";

import { processLibraryMigrateJob } from "@rawkoon/api/services/jobs/libraryMigrateWorker";

describe("processLibraryMigrateJob", () => {
  it("scrubs the API keys from job data even when the run fails", async () => {
    const updates: Record<string, unknown>[] = [];
    const job = {
      data: {
        source: "radarr",
        requested_by: "u1",
        radarr_url: "http://r",
        radarr_api_key: "secret",
        sonarr_api_key: "secret2",
      },
      updateData: async (d: Record<string, unknown>) => {
        updates.push(d);
      },
    };
    // The DB is not mocked here, so the run throws before finishing.
    await processLibraryMigrateJob(job as never).catch(() => {});
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({
      radarr_url: "http://r",
      radarr_api_key: undefined,
      sonarr_api_key: undefined,
    });
  });
});
