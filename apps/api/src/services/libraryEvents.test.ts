import { expect, test } from "bun:test";
import type { DownloadProgressUpdateEvent } from "@rawkoon/api/services/libraryEvents";
import {
  emitDownloadProgress,
  libraryEventBus,
} from "@rawkoon/api/services/libraryEvents";

test("emitDownloadProgress fires a download-progress event with the payload", async () => {
  const received = await new Promise<DownloadProgressUpdateEvent>((resolve) => {
    libraryEventBus.once(
      "download-progress",
      (e: DownloadProgressUpdateEvent) => resolve(e),
    );
    emitDownloadProgress(42, [
      {
        id: 7,
        progress: 0.5,
        state: "downloading",
        downloadSpeed: 1234,
        etaSeconds: null,
      },
    ]);
  });

  expect(received.mediaId).toBe(42);
  expect(received.downloads).toEqual([
    {
      id: 7,
      progress: 0.5,
      state: "downloading",
      downloadSpeed: 1234,
      etaSeconds: null,
    },
  ]);
  expect(typeof received.ts).toBe("number");
});
