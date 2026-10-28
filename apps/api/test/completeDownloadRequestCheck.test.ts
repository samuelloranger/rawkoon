import { describe, expect, it, mock } from "bun:test";
import { dbModule } from "./mocks/prisma";
import { recordingEffects } from "./mocks/outcomeEffects";

// A failed request-availability check must not stop post-processing from being queued.

const jobs: unknown[] = [];

mock.module("@rawkoon/api/db", () =>
  dbModule({
    prisma: {
      mediaSettings: {
        findUnique: async () => ({ postProcessingEnabled: true }),
      },
    },
  }),
);
mock.module("@rawkoon/api/services/queueService", () => ({
  QUEUE_NAMES: { LIBRARY_POST_PROCESS: "library-post-process" },
  POST_PROCESS_JOB_NAME: "post-process",
  addJob: async (...args: unknown[]) => {
    jobs.push(args);
    return {};
  },
}));

const { completeDownload } = await import(
  "@rawkoon/api/services/downloads/downloadOutcome"
);

describe("completeDownload", () => {
  it("still queues post-processing when the availability check throws", async () => {
    const effects = recordingEffects();
    effects.requestAvailable = async () => {
      throw new Error("db hiccup");
    };
    await completeDownload({ id: 7, mediaId: 3, episodeId: 9 }, effects);
    expect(jobs).toHaveLength(1);
  });
});
