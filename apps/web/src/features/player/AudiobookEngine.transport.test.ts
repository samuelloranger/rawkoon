import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { AudiobookEngine } from "@/features/player/AudiobookEngine";
import type { BookManifest } from "@rawkoon/shared/types";

/**
 * Transport behaviour under a hostile AudioContext — the iOS case.
 *
 * On iOS the AudioContext is suspended aggressively (backgrounding the PWA, an
 * audio-session interruption, a route change) and `resume()` outside a user
 * gesture returns a promise that never settles. These tests model exactly that,
 * because it is the difference between "the element plays" and "the transport
 * is wedged and every tap does nothing".
 *
 * The engine's pure timeline helpers are covered in AudiobookEngine.test.ts;
 * this file drives the class, which had no coverage at all.
 */

class FakeAudio {
  src = "";
  currentTime = 0;
  readyState = 0;
  playbackRate = 1;
  preservesPitch = false;
  preload = "";
  paused = true;
  /** Browsers always set this before firing `error`; a seek abort sets code 1. */
  error: { code: number } | null = null;
  buffered = { length: 0, start: () => 0, end: () => 0 };
  playCalls = 0;
  private listeners = new Map<string, Set<(event?: unknown) => void>>();

  addEventListener(type: string, fn: (event?: unknown) => void) {
    const set = this.listeners.get(type) ?? new Set();
    set.add(fn);
    this.listeners.set(type, set);
  }

  removeEventListener(type: string, fn: (event?: unknown) => void) {
    this.listeners.get(type)?.delete(fn);
  }

  dispatch(type: string) {
    for (const fn of [...(this.listeners.get(type) ?? [])]) fn();
  }

  /** When the resource is unreachable, no `playing` ever arrives. */
  broken = false;

  /** Resolves like a browser that is perfectly willing to play. */
  play = async (): Promise<void> => {
    this.playCalls++;
    if (this.broken) throw new Error("NotSupportedError");
    this.paused = false;
    this.dispatch("playing");
  };

  pause = () => {
    this.paused = true;
    this.dispatch("pause");
  };

  load = () => {
    this.readyState = 0;
  };

  removeAttribute(name: string) {
    if (name === "src") this.src = "";
  }

  /** Pretend metadata arrived, which is what unblocks a queued seek. */
  metadataReady(duration = 600) {
    this.readyState = 1;
    this.duration = duration;
    this.dispatch("loadedmetadata");
  }

  duration = 600;
}

/** An AudioContext that behaves the way iOS does when it refuses to resume. */
class HostileAudioContext {
  state = "suspended";
  destination = {};
  resumeCalls = 0;
  sourceCalls = 0;

  resume = (): Promise<void> => {
    this.resumeCalls++;
    // Never settles. This is the whole point.
    return new Promise<void>(() => {});
  };

  createMediaElementSource = () => {
    this.sourceCalls++;
    return { connect: () => {} };
  };

  createGain = () => ({ gain: { value: 1 }, connect: () => {} });

  createDynamicsCompressor = () => ({
    threshold: { value: 0 },
    knee: { value: 0 },
    ratio: { value: 0 },
    connect: () => {},
  });
}

const manifest = (): BookManifest =>
  ({
    edition_id: 1,
    book_id: 1,
    kind: "audiobook",
    title: "Un palais d'épines et de roses",
    authors: ["Sarah J. Maas"],
    narrators: [],
    cover_url: null,
    total_duration_secs: 1200,
    primary_file_id: null,
    progress: null,
    files: [
      {
        id: 1,
        file_name: "01 - Chapitre 1.mp3",
        format: "mp3",
        size_bytes: "1000",
        duration_secs: 600,
        offset_secs: 0,
        readable: true,
        chapters: [],
        content_url: "/api/books/files/1/content",
      },
      {
        id: 2,
        file_name: "02 - Chapitre 2.mp3",
        format: "mp3",
        size_bytes: "1000",
        duration_secs: 600,
        offset_secs: 600,
        readable: true,
        chapters: [],
        content_url: "/api/books/files/2/content",
      },
    ],
  }) as unknown as BookManifest;

let audios: FakeAudio[] = [];
let contexts: HostileAudioContext[] = [];

beforeEach(() => {
  audios = [];
  contexts = [];
  vi.stubGlobal(
    "Audio",
    class {
      constructor() {
        const audio = new FakeAudio();
        audios.push(audio);
        return audio as unknown as HTMLAudioElement;
      }
    },
  );
  vi.stubGlobal(
    "AudioContext",
    class {
      constructor() {
        const context = new HostileAudioContext();
        contexts.push(context);
        return context as unknown as AudioContext;
      }
    },
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Fails rather than hanging the suite when play() never resolves. */
const settlesWithin = async (
  promise: Promise<unknown>,
  ms = 100,
): Promise<boolean> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), ms);
  });
  const result = await Promise.race([promise.then(() => "settled"), timeout]);
  if (timer) clearTimeout(timer);
  return result === "settled";
};

describe("AudiobookEngine transport with a suspended AudioContext", () => {
  it("still starts playback when the context refuses to resume", async () => {
    const engine = new AudiobookEngine();
    await engine.load(manifest());

    const settled = await settlesWithin(engine.play());

    expect(settled).toBe(true);
    expect(audios[0]?.playCalls).toBe(1);
    expect(engine.getState().playing).toBe(true);
  });

  it("keeps responding to toggle after a refused resume", async () => {
    const engine = new AudiobookEngine();
    await engine.load(manifest());

    await settlesWithin(engine.toggle());
    expect(engine.getState().playing).toBe(true);

    await settlesWithin(engine.toggle());
    expect(engine.getState().playing).toBe(false);
  });

  it("does not route the element through a graph for plain playback", async () => {
    // Routing via createMediaElementSource makes sound depend on the context.
    // With no boost asked for, the element must own its own output, or a
    // suspended context means silence with no way back.
    const engine = new AudiobookEngine();
    await engine.load(manifest());
    await settlesWithin(engine.play());

    expect(contexts[0]?.sourceCalls ?? 0).toBe(0);
  });
});

describe("AudiobookEngine skipping", () => {
  it("does not walk the file index forward on a transient media error", async () => {
    const engine = new AudiobookEngine();
    await engine.load(manifest());
    await settlesWithin(engine.play());

    // A src swap during a seek makes the element fire `error`; that must not be
    // read as "this file is unreadable, move to the next one".
    audios[0]?.dispatch("error");

    expect(engine.getState().position).toBeLessThan(600);
  });

  it("still skips a file the browser reports as genuinely undecodable", async () => {
    // The fix must not cost the original behaviour: one corrupt file in a
    // 60-file audiobook should be stepped over, not end the book.
    const engine = new AudiobookEngine();
    await engine.load(manifest());
    await settlesWithin(engine.play());

    const audio = audios[0];
    if (audio) {
      audio.error = { code: 3 }; // MEDIA_ERR_DECODE
      audio.dispatch("error");
    }

    expect(engine.getState().error).toBe("01 - Chapitre 1.mp3");
    expect(engine.getState().position).toBe(600);
  });

  it("ignores an error fired by an aborted load during a seek", async () => {
    const engine = new AudiobookEngine();
    await engine.load(manifest());
    await settlesWithin(engine.play());

    const audio = audios[0];
    if (audio) {
      audio.error = { code: 1 }; // MEDIA_ERR_ABORTED
      audio.dispatch("error");
    }

    expect(engine.getState().error).toBeNull();
    expect(engine.getState().position).toBeLessThan(600);
  });

  it("survives a burst of skips and stays on a playable position", async () => {
    const engine = new AudiobookEngine();
    await engine.load(manifest());
    await settlesWithin(engine.play());

    for (let i = 0; i < 12; i++) engine.skip(30);
    for (let i = 0; i < 12; i++) engine.skip(-15);

    const state = engine.getState();
    expect(state.position).toBeGreaterThanOrEqual(0);
    expect(state.position).toBeLessThanOrEqual(state.duration);
    expect(state.error).toBeNull();
  });
});

describe("AudiobookEngine across file boundaries", () => {
  it("crosses into the next file when skipping past the first one", async () => {
    const engine = new AudiobookEngine();
    await engine.load(manifest());
    await settlesWithin(engine.play());

    // 25 x 30s = 750s, which is inside file 2 (offset 600).
    for (let i = 0; i < 25; i++) engine.skip(30);

    expect(engine.getState().position).toBe(750);
    expect(engine.currentFileId()).toBe(2);
    expect(engine.getState().error).toBeNull();
  });

  it("declares completion only when the last file ends", async () => {
    const engine = new AudiobookEngine();
    await engine.load(manifest());
    await settlesWithin(engine.play());

    // End of file 1: move on, do not call the book finished.
    audios[0]?.dispatch("ended");
    expect(engine.getState().completed).toBe(false);
    expect(engine.currentFileId()).toBe(2);

    audios[0]?.dispatch("ended");
    expect(engine.getState().completed).toBe(true);
    expect(engine.getState().playing).toBe(false);
  });

  it("does not let a superseded metadata seek drag the new file back", async () => {
    const engine = new AudiobookEngine();
    await engine.load(manifest());
    await settlesWithin(engine.play());

    const audio = audios[0];
    if (!audio) throw new Error("no element");

    // Queue a seek inside file 1 while metadata is still missing...
    audio.readyState = 0;
    engine.seekAbsolute(300);
    // ...then cross into file 2 before that metadata ever arrives.
    engine.seekAbsolute(900);
    audio.metadataReady();

    // The stale listener would have pulled currentTime back to 300.
    expect(audio.currentTime).toBe(300);
    expect(engine.currentFileId()).toBe(2);
  });
});

describe("AudiobookEngine network errors", () => {
  it("retries the same file instead of skipping it", async () => {
    vi.useFakeTimers();
    try {
      const engine = new AudiobookEngine();
      await engine.load(manifest());
      await engine.play();

      const audio = audios[0];
      if (audio) {
        audio.error = { code: 2 }; // MEDIA_ERR_NETWORK
        audio.dispatch("error");
      }

      // Still on file 1, and not reported as a bad file.
      expect(engine.currentFileId()).toBe(1);
      expect(engine.getState().error).toBeNull();

      await vi.advanceTimersByTimeAsync(600);
      expect(engine.currentFileId()).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("retries from where playback actually was, not the load offset", async () => {
    vi.useFakeTimers();
    try {
      const engine = new AudiobookEngine();
      await engine.load(manifest());
      await engine.play();

      const audio = audios[0];
      if (!audio) throw new Error("no element");
      audio.readyState = 1;
      // Twenty minutes in, with no seek since the file was loaded at 0.
      audio.currentTime = 1200;

      audio.error = { code: 2 }; // MEDIA_ERR_NETWORK
      audio.dispatch("error");
      await vi.advanceTimersByTimeAsync(600);

      // Retrying from the stale requestedOffset would have rewound to 0.
      expect(audio.currentTime).toBe(1200);
    } finally {
      vi.useRealTimers();
    }
  });

  it("reports the element clock alongside the offset it resumed from", async () => {
    vi.useFakeTimers();
    try {
      const engine = new AudiobookEngine();
      const reports: Array<Record<string, unknown>> = [];
      engine.onDiagnostic = (d) =>
        reports.push(d as unknown as Record<string, unknown>);
      await engine.load(manifest());
      await engine.play();

      const audio = audios[0];
      if (!audio) throw new Error("no element");
      audio.readyState = 1;
      audio.currentTime = 112;
      audio.dispatch("timeupdate");

      audio.currentTime = 0;
      audio.error = { code: 2 };
      audio.dispatch("error");
      await vi.advanceTimersByTimeAsync(600);

      // Loads are journalled too now, so narrow to the error itself.
      const errors = reports.filter((r) => r.event === "error");
      // This pair is the whole point: a clock of 0 with a resume offset that
      // is not 0 proves the fallback held, and the reverse proves a rewind.
      expect(errors).toHaveLength(1);
      expect(errors[0]).toMatchObject({
        event: "error",
        errorCode: 2,
        currentTime: 0,
        resumeOffset: 112,
        retryAttempt: 1,
        reason: "network-retry",
        fileId: 1,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  // The reported iOS case: locked screen, a chapter entered by natural
  // boundary crossing (so requestedOffset is 0 for its whole length), and an
  // element that reports currentTime 0 once it enters the error state — which
  // is what WebKit does when the connection drops or the service worker
  // serving the bytes is killed mid-request. Falling back to requestedOffset
  // then restarts the chapter from its beginning.
  it("retries from the last position seen, even if the clock reads zero on error", async () => {
    vi.useFakeTimers();
    try {
      const engine = new AudiobookEngine();
      await engine.load(manifest());
      await engine.play();

      const audio = audios[0];
      if (!audio) throw new Error("no element");
      audio.readyState = 1;

      // Cross into the second file the way playback does, leaving
      // requestedOffset at 0 for the rest of the chapter.
      audio.currentTime = 600;
      audio.dispatch("ended");
      await vi.advanceTimersByTimeAsync(0);
      expect(engine.currentFileId()).toBe(2);

      // A minute fifty into the new chapter.
      audio.currentTime = 112;
      audio.dispatch("timeupdate");

      // The connection drops and the element forgets where it was.
      audio.currentTime = 0;
      audio.error = { code: 2 }; // MEDIA_ERR_NETWORK
      audio.dispatch("error");
      await vi.advanceTimersByTimeAsync(600);

      expect(engine.currentFileId()).toBe(2);
      expect(audio.currentTime).toBe(112);
      expect(engine.getState().position).toBe(712);
    } finally {
      vi.useRealTimers();
    }
  });

  it("gives up and skips after the retry budget is spent", async () => {
    vi.useFakeTimers();
    try {
      const engine = new AudiobookEngine();
      await engine.load(manifest());
      await engine.play();

      const audio = audios[0];
      if (!audio) throw new Error("no element");
      // Unreachable for good: every retry fails, so `playing` never arrives to
      // reset the budget.
      audio.broken = true;
      for (let attempt = 0; attempt < 4; attempt++) {
        audio.error = { code: 2 };
        audio.dispatch("error");
        await vi.advanceTimersByTimeAsync(5000);
      }

      expect(engine.currentFileId()).toBe(2);
      expect(engine.getState().error).toBe("01 - Chapitre 1.mp3");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("AudiobookEngine unload", () => {
  it("retires the routed element and the boost with it", async () => {
    const engine = new AudiobookEngine();
    await engine.load(manifest());
    await settlesWithin(engine.play());

    engine.setBoostDb(6);
    expect(contexts[0]?.sourceCalls).toBe(1);
    expect(engine.getState().boostDb).toBe(6);

    engine.unload();

    expect(engine.getState().boostDb).toBe(0);
    expect(engine.getState().editionId).toBeNull();
    expect(engine.currentFileId()).toBeNull();

    // The next book must not inherit the previous graph.
    await engine.load(manifest());
    await settlesWithin(engine.play());
    expect(contexts).toHaveLength(1);
  });
});

// The rewind is still unexplained, and the first round of instrumentation
// reported nothing because it only fired on errors the engine acts on. These
// cover the transitions that were invisible: an element that throws its
// resource away (iOS memory pressure), a stream that ends a file early, and the
// error codes the engine deliberately ignores.
describe("AudiobookEngine journal coverage", () => {
  const collect = async () => {
    const engine = new AudiobookEngine();
    const reports: Array<Record<string, unknown>> = [];
    engine.onDiagnostic = (d) =>
      reports.push(d as unknown as Record<string, unknown>);
    await engine.load(manifest());
    await settlesWithin(engine.play());
    return { engine, reports };
  };

  it("names why every load ran", async () => {
    const { engine, reports } = await collect();
    engine.seekAbsolute(700); // crosses into the second file

    expect(
      reports.filter((r) => r.event === "load").map((r) => r.reason),
    ).toEqual(["open", "seek"]);
  });

  it("records an emptied element with the readyState that proves it", async () => {
    const { reports } = await collect();
    const audio = audios[0];
    if (!audio) throw new Error("no element");
    audio.readyState = 1;
    audio.currentTime = 240;
    audio.dispatch("timeupdate");

    // What iOS does when it reclaims the resource: clock and readyState to 0.
    audio.currentTime = 0;
    audio.readyState = 0;
    audio.dispatch("emptied");

    const emptied = reports.filter((r) => r.event === "emptied");
    expect(emptied).toHaveLength(1);
    expect(emptied[0]).toMatchObject({
      currentTime: 0,
      readyState: 0,
      fileId: 1,
    });
    // The position it had before the element forgot is what makes the entry
    // readable: 0 here would mean the state had already been rewound.
    expect(emptied[0]?.position).toBe(240);
  });

  it("records an early end before it advances a file", async () => {
    const { reports } = await collect();
    const audio = audios[0];
    if (!audio) throw new Error("no element");
    audio.readyState = 1;
    audio.currentTime = 120; // nowhere near the file's 600s duration
    audio.dispatch("timeupdate");
    audio.dispatch("ended");

    const ended = reports.filter((r) => r.event === "ended");
    expect(ended).toHaveLength(1);
    // A truncated stream is exactly this: `ended` with the clock far short of
    // the file's duration, followed by a boundary load into the next file.
    expect(ended[0]).toMatchObject({ currentTime: 120, fileIndex: 0 });
    expect(
      reports.filter((r) => r.event === "load").map((r) => r.reason),
    ).toEqual(["open", "boundary"]);
  });

  it("records the errors it deliberately does not act on", async () => {
    const { engine, reports } = await collect();
    const audio = audios[0];
    if (!audio) throw new Error("no element");

    // A src swap mid-seek: code 1, ignored on purpose.
    audio.error = { code: 1 };
    audio.dispatch("error");

    const ignored = reports.filter((r) => r.event === "error-ignored");
    expect(ignored).toHaveLength(1);
    expect(ignored[0]).toMatchObject({ errorCode: 1 });
    // Still ignored: the index must not have moved.
    expect(engine.getState().position).toBeLessThan(600);
  });
});

// "The back and next buttons do not always work." Assigning currentTime while
// readyState is HAVE_NOTHING does not seek — the spec makes it set the default
// playback start position, which only applies to the next load. The state had
// already been emitted at the new position, so the next timeupdate snapped it
// back and the press looked ignored. On iOS the element loses its resource
// often enough for that to be the common case, not the rare one.
describe("AudiobookEngine seeking an element with no metadata", () => {
  it("applies a same-file seek once metadata arrives", async () => {
    const engine = new AudiobookEngine();
    await engine.load(manifest());
    await settlesWithin(engine.play());

    const audio = audios[0];
    if (!audio) throw new Error("no element");
    audio.readyState = 0; // resource reclaimed
    audio.currentTime = 0;

    engine.seekAbsolute(120);
    // Nothing can have moved yet — there is no media to seek.
    expect(audio.currentTime).toBe(0);

    audio.metadataReady();
    expect(audio.currentTime).toBe(120);
  });

  it("seeks immediately when the element already has metadata", async () => {
    const engine = new AudiobookEngine();
    await engine.load(manifest());
    await settlesWithin(engine.play());

    const audio = audios[0];
    if (!audio) throw new Error("no element");
    audio.readyState = 1;

    engine.seekAbsolute(200);
    expect(audio.currentTime).toBe(200);
  });

  it("drops a queued seek that a later load has overtaken", async () => {
    const engine = new AudiobookEngine();
    await engine.load(manifest());
    await settlesWithin(engine.play());

    const audio = audios[0];
    if (!audio) throw new Error("no element");
    audio.readyState = 0;

    engine.seekAbsolute(120); // queued against the first file
    engine.seekAbsolute(900); // crosses into the second file, so a real load

    // One element does the transport — a later entry in `audios` is the
    // preload, not the thing playing.
    // The queued 120 must not drag the new file back to the old file's offset.
    audio.metadataReady();
    expect(audio.currentTime).toBe(300); // 900 - the second file's 600 offset
  });
});

// The architectural fix: served as one seekable resource, the transport stops
// stitching files and the browser does the seeking. These hold the collapse —
// if any of them starts failing, the boundary machinery has crept back.
describe("AudiobookEngine on a single-stream edition", () => {
  const streamed = (): BookManifest =>
    ({
      ...manifest(),
      stream_url: "/api/books/editions/1/stream",
    }) as unknown as BookManifest;

  it("loads one source for the whole book", async () => {
    const engine = new AudiobookEngine();
    await engine.load(streamed());

    expect(audios[0]?.src).toBe("/api/books/editions/1/stream");
    expect(engine.getState().duration).toBe(1200);
  });

  it("seeks past what used to be a file boundary without swapping src", async () => {
    const engine = new AudiobookEngine();
    await engine.load(streamed());
    await settlesWithin(engine.play());

    const audio = audios[0];
    if (!audio) throw new Error("no element");
    audio.readyState = 1;
    const srcBefore = audio.src;

    // 900 lands in what was the second file. On one resource it is just a
    // position: no load, no metadata wait, no offset arithmetic.
    engine.seekAbsolute(900);

    expect(audio.src).toBe(srcBefore);
    expect(audio.currentTime).toBe(900);
    expect(engine.getState().position).toBe(900);
  });

  it("reports positions absolutely, straight from the element", async () => {
    const engine = new AudiobookEngine();
    await engine.load(streamed());
    await settlesWithin(engine.play());

    const audio = audios[0];
    if (!audio) throw new Error("no element");
    audio.currentTime = 754;
    audio.dispatch("timeupdate");

    // Previously this was file.offset + currentTime, and the offset was only
    // right if the correct file happened to be loaded.
    expect(engine.getState().position).toBe(754);
  });

  it("preloads nothing, because there is no next file", async () => {
    const engine = new AudiobookEngine();
    await engine.load(streamed());
    await settlesWithin(engine.play());

    // One element total: the transport. The multi-file path builds a second
    // one to warm the next file's connection.
    expect(audios).toHaveLength(1);
  });

  it("treats ended as the end of the book, not a boundary", async () => {
    const engine = new AudiobookEngine();
    await engine.load(streamed());
    await settlesWithin(engine.play());

    audios[0]?.dispatch("ended");

    // The truncated-stream trap: on the multi-file path an early `ended`
    // silently advanced a chapter. Here it can only mean completion.
    expect(engine.getState().completed).toBe(true);
    expect(engine.getState().playing).toBe(false);
    expect(audios).toHaveLength(1);
  });

  it("stops claiming a file for the position", async () => {
    const engine = new AudiobookEngine();
    await engine.load(streamed());

    // Absolute across one resource, so no single BookFile describes it.
    expect(engine.currentFileId()).toBeNull();
  });

  it("still stitches a timeline when no stream is offered", async () => {
    const engine = new AudiobookEngine();
    await engine.load(manifest());
    await settlesWithin(engine.play());

    expect(audios[0]?.src).toBe("/api/books/files/1/content");
    expect(engine.currentFileId()).toBe(1);
  });
});

describe("AudiobookEngine single stream while offline", () => {
  it("keeps the per-file timeline, which is what the cache holds", async () => {
    const onLine = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    try {
      const engine = new AudiobookEngine();
      await engine.load({
        ...manifest(),
        stream_url: "/api/books/editions/1/stream",
      } as unknown as BookManifest);

      // The worker stores downloaded books by file id, so requesting the
      // stream offline would miss a cache that has every byte of the book.
      expect(audios[0]?.src).toBe("/api/books/files/1/content");
      expect(engine.currentFileId()).toBe(1);
    } finally {
      onLine.mockRestore();
    }
  });
});

// Resuming mid-book on a single-stream edition. `locate` was run against the
// per-file timeline while `loadFile` indexed the one-entry stream timeline, so
// any saved position past the first file resolved to an index that did not
// exist, loadFile bailed, and no element was ever created — the player just sat
// there. Position 0 was the only case that worked, which is why it passed a
// first test run and failed every one after it.
describe("AudiobookEngine resuming a single-stream edition", () => {
  const streamedAt = (position: number): BookManifest =>
    ({
      ...manifest(),
      stream_url: "/api/books/editions/1/stream",
      progress: { position_secs: position },
    }) as unknown as BookManifest;

  it("loads when the saved position is past the first file", async () => {
    const engine = new AudiobookEngine();
    // 900s lands in the second file of the per-file timeline — the index that
    // does not exist once the timeline is a single entry.
    await engine.load(streamedAt(900));

    expect(audios).toHaveLength(1);
    expect(audios[0]?.src).toBe("/api/books/editions/1/stream");
    expect(engine.getState().position).toBe(900);
  });

  it("still loads from the very start", async () => {
    const engine = new AudiobookEngine();
    await engine.load(streamedAt(0));

    expect(audios).toHaveLength(1);
    expect(engine.getState().position).toBe(0);
  });

  it("seeks the element to the resumed position once metadata lands", async () => {
    const engine = new AudiobookEngine();
    // Inside the fixture's 1200s duration and past its first 600s file.
    await engine.load(streamedAt(1100));

    const audio = audios[0];
    if (!audio) throw new Error("no element");
    audio.metadataReady(1200);
    expect(audio.currentTime).toBe(1100);
  });

  it("clamps a saved position past the end of the book", async () => {
    const engine = new AudiobookEngine();
    await engine.load(streamedAt(99999));

    expect(engine.getState().position).toBe(1200);
  });
});
