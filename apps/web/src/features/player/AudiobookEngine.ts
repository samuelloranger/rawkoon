import type { BookManifest, BookManifestFile } from "@rawkoon/shared/types";

/**
 * Audiobook playback, framework-free.
 *
 * One HTMLAudioElement does the transport: it is what streams a 700MB m4b by
 * Range, decodes m4b and flac in hardware, and keeps playing in the background.
 * A Web Audio graph hangs off it for what the element cannot do — gain above
 * 100% for quiet narration, and light compression so whispered passages do not
 * need a volume ride.
 *
 * A multi-file audiobook is one flat timeline here, not in the UI: the engine
 * maps absolute seconds to (file, offset), preloads the next file, and swaps
 * sources at the boundary.
 */

export interface EngineChapter {
  index: number;
  label: string | null;
  /** Absolute, on the edition's timeline. */
  start: number;
  end: number;
}

export interface EngineState {
  editionId: number | null;
  title: string;
  authors: string[];
  narrators: string[];
  coverUrl: string | null;
  bookId: number | null;
  /** Absolute position across every file. */
  position: number;
  duration: number;
  playing: boolean;
  /** True while the element is seeking or filling its buffer. */
  loading: boolean;
  rate: number;
  boostDb: number;
  chapters: EngineChapter[];
  chapterIndex: number;
  buffered: Array<{ start: number; end: number }>;
  error: string | null;
  /**
   * Set once, when the last file reports `ended`.
   *
   * Completion is an event, not a position: inferring it from
   * `position >= duration - 1` marked a book finished whenever a listener
   * paused in the final second, or when the last file failed to decode.
   */
  completed: boolean;
}

const EMPTY_STATE: EngineState = {
  editionId: null,
  title: "",
  authors: [],
  narrators: [],
  coverUrl: null,
  bookId: null,
  position: 0,
  duration: 0,
  playing: false,
  loading: false,
  rate: 1,
  boostDb: 0,
  chapters: [],
  chapterIndex: 0,
  buffered: [],
  error: null,
  completed: false,
};

export const MIN_RATE = 0.5;
export const MAX_RATE = 3;

interface TimelineFile {
  id: number;
  url: string;
  offset: number;
  duration: number;
  name: string;
}

/** Flattens a manifest into an absolute timeline plus absolute chapter marks. */
export const buildTimeline = (
  files: BookManifestFile[],
): {
  timeline: TimelineFile[];
  chapters: EngineChapter[];
  duration: number;
} => {
  const timeline: TimelineFile[] = files.map((file) => ({
    id: file.id,
    url: file.content_url,
    offset: file.offset_secs,
    duration: file.duration_secs ?? 0,
    name: file.file_name,
  }));

  const chapters: EngineChapter[] = [];
  files.forEach((file) => {
    file.chapters.forEach((chapter) => {
      chapters.push({
        index: chapters.length,
        label: chapter.title,
        start: file.offset_secs + chapter.start_secs,
        end: file.offset_secs + chapter.end_secs,
      });
    });
  });

  const duration = timeline.reduce((sum, file) => sum + file.duration, 0);

  return { timeline, chapters, duration };
};

/** Which file holds an absolute position, and where inside it. */
export const locate = (
  timeline: TimelineFile[],
  position: number,
): { index: number; offset: number } | null => {
  if (timeline.length === 0) return null;
  const clamped = Math.max(0, position);
  for (let i = timeline.length - 1; i >= 0; i--) {
    const file = timeline[i];
    if (clamped >= file.offset || i === 0) {
      return {
        index: i,
        // A position past the end of the last file lands on its final second
        // rather than out of bounds.
        offset: Math.min(Math.max(0, clamped - file.offset), file.duration),
      };
    }
  }
  return null;
};

export const chapterIndexAt = (
  chapters: EngineChapter[],
  position: number,
): number => {
  for (let i = chapters.length - 1; i >= 0; i--) {
    if (position >= chapters[i].start) return i;
  }
  return 0;
};

/** MediaError codes; the constants are absent in some test DOMs. */
const ERR_ABORTED = 1;
const ERR_NETWORK = 2;

/** A dropped mobile connection is worth retrying; a corrupt file is not. */
const MAX_NETWORK_RETRIES = 3;
const RETRY_BASE_MS = 500;

/**
 * iOS ignores `preload` and gives a second media element the power to take the
 * audio session from the one that is playing, so preloading there costs the
 * transport and buys nothing.
 */
const prefersNoPreload = (): boolean => {
  try {
    const nav = navigator as Navigator & { maxTouchPoints?: number };
    if (/iPad|iPhone|iPod/.test(nav.userAgent)) return true;
    // iPadOS reports itself as a Mac; touch points are what separate them.
    return /Mac/.test(nav.userAgent) && (nav.maxTouchPoints ?? 0) > 1;
  } catch {
    return false;
  }
};

/** Absent in some test DOMs, and a missing navigator must not mean "offline". */
const isOnline = (): boolean => {
  try {
    return navigator.onLine !== false;
  } catch {
    return true;
  }
};

type Listener = () => void;

/**
 * One transport transition, for the playback journal.
 *
 * Errors alone were not enough. The mid-listen rewind reported none, and an
 * error is only one of the ways the element can lose its place: iOS throws the
 * resource away under memory pressure (`emptied`, readyState back to 0), a
 * truncated stream can end a file early (`ended`, which advances a file), and
 * an unload or a seek-abort fires `error` with a code the engine deliberately
 * ignores. Every one of those is recorded, so the evidence can name the path
 * instead of leaving it to be guessed.
 */
export interface PlaybackDiagnostic {
  /** The transition: see EngineEvent. */
  event: EngineEvent;
  editionId: number | null;
  fileId: number | null;
  fileIndex: number;
  /** MediaError.code: 1 aborted, 2 network, 3 decode, 4 unsupported. */
  errorCode: number | null;
  /** The element's own clock — 0 or null mid-file is the smoking gun. */
  currentTime: number | null;
  /** HTMLMediaElement.readyState; 0 means the resource is gone. */
  readyState: number | null;
  /** Where a load or retry aimed, when the event was one. */
  resumeOffset: number | null;
  /** Absolute position on the timeline, as the UI would show it. */
  position: number | null;
  retryAttempt: number | null;
  /** Why a load ran. Null for events that are not loads. */
  reason: LoadReason | null;
}

/** Why `loadFile` was called — the discriminator that names a rewind's path. */
export type LoadReason =
  | "open"
  | "seek"
  | "boundary"
  | "network-retry"
  | "skip-unreadable";

export type EngineEvent =
  | "load"
  | "ended"
  | "emptied"
  | "stalled"
  | "abort"
  | "error"
  | "error-ignored";

export class AudiobookEngine {
  private audio: HTMLAudioElement | null = null;
  private context: AudioContext | null = null;
  private gain: GainNode | null = null;
  private preload: HTMLAudioElement | null = null;
  private preloadUrl: string | null = null;
  private timeline: TimelineFile[] = [];
  private fileIndex = 0;
  private listeners = new Set<Listener>();
  private state: EngineState = EMPTY_STATE;

  /**
   * Bumped on every source change and on unload.
   *
   * The element is one shared resource driven by overlapping async work: a
   * `play()` promise, a `loadedmetadata` seek, an `error`. Without an owner
   * stamp, a superseded operation still lands — an aborted play() rejecting
   * after a newer one succeeded reported `playing: false` while audio was
   * running, and a stale metadata listener seeked the new file to the old
   * file's offset.
   */
  /**
   * Where a media error is reported, if anyone is listening.
   *
   * The engine does no I/O of its own; the provider owns the request. Reported
   * for every real error, retried or not, because the pair worth having is the
   * element's clock and the offset the engine decided to resume from — that is
   * what says whether a listener was rewound.
   */
  onDiagnostic: ((diagnostic: PlaybackDiagnostic) => void) | null = null;

  private generation = 0;

  /** What the listener asked for, as opposed to what the element reports. */
  private desiredPlaying = false;
  private currentUrl: string | null = null;
  /** Where in the current file playback was meant to be, for a retry. */
  private requestedOffset = 0;
  /**
   * The last offset the element actually reported while it was healthy.
   *
   * An errored element can report `currentTime` 0, and `requestedOffset` is 0
   * for the whole of any file entered by a boundary crossing — so with only
   * those two, a dropped connection restarted the chapter from its beginning.
   */
  private lastSeenOffset = 0;
  /**
   * True when the edition is served as one seekable resource.
   *
   * The timeline then holds a single entry spanning the whole book, so every
   * path that used to handle boundaries degenerates on its own: `locate` always
   * resolves to entry zero, nothing preloads, `ended` can only mean the book
   * ended, and a seek is a plain `currentTime` write the browser resolves with
   * its own range request. That collapse is the point — scrubbing, the clock
   * and resume-after-error all used to break in the stitching.
   */
  private singleStream = false;
  private networkRetries = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly noPreload = prefersNoPreload();

  /** `useSyncExternalStore` reads this; it is replaced, never mutated. */
  getState = (): EngineState => this.state;

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private emit(patch: Partial<EngineState>) {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }

  /**
   * Built only when boost is actually asked for.
   *
   * `createMediaElementSource` permanently reroutes the element's output into
   * the context, so from then on sound exists only while that context runs.
   * iOS suspends it on backgrounding, on an audio-session interruption and on
   * a route change, which turned plain playback silent with no way back. Plain
   * playback therefore keeps the element's own output and never comes here,
   * and `unload` throws the routed element away so the next book starts clean.
   */
  private ensureGraph(audio: HTMLAudioElement) {
    if (this.context) return;
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!Ctor) return;
    try {
      const context = new Ctor();
      const source = context.createMediaElementSource(audio);
      const gain = context.createGain();
      const compressor = context.createDynamicsCompressor();
      // Gentle: enough to lift a whispered passage, not enough to flatten a
      // performance.
      compressor.threshold.value = -24;
      compressor.knee.value = 30;
      compressor.ratio.value = 3;
      source.connect(gain);
      gain.connect(compressor);
      compressor.connect(context.destination);
      // Once the element is routed through the context, a suspended context is
      // silence — so try to recover from every suspension, not just at play().
      context.addEventListener?.("statechange", () => {
        if (context.state !== "running" && this.desiredPlaying) {
          void context.resume().catch(() => {});
        }
      });
      this.context = context;
      this.gain = gain;
    } catch {
      // Without a graph the element still plays; only boost is unavailable.
      this.context = null;
      this.gain = null;
    }
  }

  private get file(): TimelineFile | undefined {
    return this.timeline[this.fileIndex];
  }

  private absolute(): number {
    const file = this.file;
    if (!file || !this.audio) return 0;
    return file.offset + this.audio.currentTime;
  }

  private ensureAudio(): HTMLAudioElement {
    const existing = this.audio;
    if (existing) return existing;
    const audio = new Audio();
    audio.preload = "metadata";
    this.attach(audio);
    this.audio = audio;
    return audio;
  }

  private attach(audio: HTMLAudioElement) {
    audio.addEventListener("timeupdate", this.onTimeUpdate);
    audio.addEventListener("progress", this.onProgress);
    audio.addEventListener("ended", this.onEnded);
    audio.addEventListener("error", this.onError);
    audio.addEventListener("waiting", this.onWaiting);
    audio.addEventListener("emptied", this.onEmptied);
    audio.addEventListener("stalled", this.onStalled);
    audio.addEventListener("abort", this.onAbort);
    audio.addEventListener("playing", this.onPlaying);
    audio.addEventListener("pause", this.onPause);
  }

  /**
   * Where a retry should resume.
   *
   * `requestedOffset` is only where the last load or seek aimed, so after
   * twenty minutes of uninterrupted playback it is twenty minutes stale — a
   * transient network error that retried from it threw away everything since.
   * The element's own clock is the truth whenever it has one, and the last
   * position it reported while healthy is the truth when it does not: an
   * errored element can report 0, and for a file entered by a boundary
   * crossing `requestedOffset` is 0 too, so the pair of them silently
   * restarted the chapter.
   */
  private liveOffset(): number {
    const current = this.audio?.currentTime;
    if (
      typeof current === "number" &&
      Number.isFinite(current) &&
      current > 0
    ) {
      return current;
    }
    if (this.lastSeenOffset > 0) return this.lastSeenOffset;
    return this.requestedOffset;
  }

  /**
   * Moves the element's clock, waiting for metadata if it has none yet.
   *
   * Assigning `currentTime` while readyState is HAVE_NOTHING does not seek —
   * the spec makes it set the default playback start position instead, which
   * only takes effect on the next load. The state had already been emitted at
   * the new position, so the next `timeupdate` snapped it back and the skip
   * buttons looked like they had done nothing. Which is exactly what happens
   * on iOS once the element's resource has been reclaimed.
   */
  private applySeek(audio: HTMLAudioElement, offset: number) {
    if (audio.readyState >= 1) {
      audio.currentTime = offset;
      return;
    }
    const generation = this.generation;
    audio.addEventListener(
      "loadedmetadata",
      () => {
        // A newer load or seek owns the element now; honouring this one would
        // drag it back to a position the listener has already left.
        if (generation !== this.generation) return;
        audio.currentTime = offset;
      },
      { once: true },
    );
  }

  private clearRetry() {
    if (this.retryTimer != null) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
  }

  private onTimeUpdate = () => {
    const current = this.audio?.currentTime;
    if (
      typeof current === "number" &&
      Number.isFinite(current) &&
      current > 0
    ) {
      this.lastSeenOffset = current;
    }
    const position = this.absolute();
    this.emit({
      position,
      chapterIndex: chapterIndexAt(this.state.chapters, position),
    });
  };

  private onProgress = () => {
    const audio = this.audio;
    const file = this.file;
    if (!audio || !file) return;
    const ranges: Array<{ start: number; end: number }> = [];
    for (let i = 0; i < audio.buffered.length; i++) {
      ranges.push({
        start: file.offset + audio.buffered.start(i),
        end: file.offset + audio.buffered.end(i),
      });
    }
    this.emit({ buffered: ranges });
  };

  private onWaiting = () => this.emit({ loading: true });

  /**
   * The element threw its resource away — iOS does this under memory pressure
   * and when a PWA is backgrounded long enough. `currentTime` is 0 afterwards,
   * which is exactly what a rewind looks like from the outside. Report-only:
   * whether to restore the position from here is a fix, and a fix needs the
   * evidence first.
   */
  private onEmptied = () => this.report("emptied", null, null, null);

  private onStalled = () => this.report("stalled", null, null, null);

  private onAbort = () => this.report("abort", null, null, null);

  private onPlaying = () => {
    // Sound is coming out, so whatever the last failure was, it is over.
    this.networkRetries = 0;
    this.emit({ playing: true, loading: false });
  };

  private onPause = () => this.emit({ playing: false });

  private onEnded = () => {
    // A truncated stream can end a file early, which advances to the next one
    // at offset 0 — indistinguishable from a real boundary without this.
    this.report("ended", null, null, null);
    if (this.fileIndex < this.timeline.length - 1) {
      void this.loadFile(this.fileIndex + 1, 0, true, "boundary");
    } else {
      this.desiredPlaying = false;
      // The only place completion is declared. PlayerProvider turns this into
      // exactly one "finished" write.
      this.emit({ playing: false, completed: true });
    }
  };

  /** Never lets a reporting failure escape into the error path it describes. */
  private report(
    event: EngineEvent,
    errorCode: number | null,
    resumeOffset: number | null,
    retryAttempt: number | null,
    reason: LoadReason | null = null,
  ) {
    const current = this.audio?.currentTime;
    const ready = this.audio?.readyState;
    try {
      this.onDiagnostic?.({
        event,
        editionId: this.state.editionId,
        fileId: this.file?.id ?? null,
        fileIndex: this.fileIndex,
        errorCode,
        currentTime:
          typeof current === "number" && Number.isFinite(current)
            ? current
            : null,
        readyState: typeof ready === "number" ? ready : null,
        resumeOffset,
        position: this.state.position,
        retryAttempt,
        reason,
      });
    } catch {
      // A diagnostic must never make the failure it reports worse.
    }
  }

  private onError = () => {
    const code = this.audio?.error?.code;
    // Swapping `src` mid-seek makes the element fire `error` with
    // MEDIA_ERR_ABORTED, and an unload fires one with no MediaError at all.
    // Neither means the file is bad, and advancing on them walked the index
    // forward one file per skip until the book ran out.
    if (code == null || code === ERR_ABORTED) {
      // Not acted on — an unload and a seek-abort both land here and neither
      // means the file is bad. Recorded all the same: if one of these is what
      // precedes a rewind, the journal is the only place that would show it.
      this.report("error-ignored", code ?? null, null, null);
      return;
    }

    const name = this.file?.name ?? "";

    // A connection that dropped for a moment is not an unreadable file. Left
    // to skip, one tunnel could walk an 83-file book to its last chapter.
    if (code === ERR_NETWORK && this.networkRetries < MAX_NETWORK_RETRIES) {
      const attempt = ++this.networkRetries;
      const index = this.fileIndex;
      const offset = this.liveOffset();
      const play = this.desiredPlaying;
      this.report("error", code, offset, attempt, "network-retry");
      this.emit({ loading: true });
      this.clearRetry();
      this.retryTimer = setTimeout(
        () => {
          this.retryTimer = null;
          void this.loadFile(index, offset, play, "network-retry");
        },
        RETRY_BASE_MS * 2 ** (attempt - 1),
      );
      return;
    }

    this.networkRetries = 0;
    this.report("error", code, null, null, "skip-unreadable");
    // A single unreadable file should not end the book: advance and say which
    // one was skipped.
    if (this.fileIndex < this.timeline.length - 1) {
      this.emit({ error: name });
      void this.loadFile(
        this.fileIndex + 1,
        0,
        this.desiredPlaying,
        "skip-unreadable",
      );
    } else {
      this.desiredPlaying = false;
      this.emit({ error: name, playing: false, loading: false });
    }
  };

  private async loadFile(
    index: number,
    offset: number,
    play: boolean,
    reason: LoadReason,
  ) {
    const file = this.timeline[index];
    if (!file) return;

    const generation = ++this.generation;
    this.clearRetry();
    this.fileIndex = index;
    this.requestedOffset = offset;
    // Belongs to the file being left behind, or to the position seeked away
    // from; either way it must not outlive this load.
    this.lastSeenOffset = offset;
    this.desiredPlaying = play;

    // Reported before the position is emitted, so the entry carries both where
    // the listener was and where this load is aiming — which is the whole
    // question when a position moves on its own.
    this.report("load", null, offset, null, reason);

    const audio = this.ensureAudio();

    if (this.currentUrl !== file.url) {
      audio.src = file.url;
      this.currentUrl = file.url;
    }
    audio.playbackRate = this.state.rate;
    // Rate alone pitch-shifts past ~1.5x in some engines; narration must stay
    // recognisable at 3x.
    audio.preservesPitch = true;

    const seek = () => {
      // A newer load owns the element now; seeking here would drag the new
      // file back to this one's offset.
      if (generation !== this.generation) return;
      if (Math.abs(audio.currentTime - offset) > 0.5) {
        audio.currentTime = offset;
      }
    };
    if (audio.readyState >= 1) seek();
    else audio.addEventListener("loadedmetadata", seek, { once: true });

    this.emit({
      position: file.offset + offset,
      chapterIndex: chapterIndexAt(this.state.chapters, file.offset + offset),
      loading: true,
    });

    this.primeNext();
    if (play) await this.play(generation);
    else this.emit({ loading: false });
  }

  /** Warms the next file's connection so a boundary crossing has no gap. */
  private primeNext() {
    if (this.noPreload) return;
    const next = this.timeline[this.fileIndex + 1];
    if (!next) {
      this.releasePreload();
      return;
    }
    if (this.preloadUrl === next.url) return;
    // One reusable element, explicitly released: a fresh Audio() per boundary
    // left its request in flight, and a rail drag across 83 files piled up
    // dozens of them.
    this.releasePreload();
    const audio = new Audio();
    audio.preload = "metadata";
    audio.src = next.url;
    this.preload = audio;
    this.preloadUrl = next.url;
  }

  private releasePreload() {
    const preload = this.preload;
    if (preload) {
      preload.pause();
      preload.removeAttribute("src");
      preload.load();
    }
    this.preload = null;
    this.preloadUrl = null;
  }

  load = async (manifest: BookManifest, startAt?: number) => {
    const { timeline, chapters, duration } = buildTimeline(manifest.files);
    const total = manifest.total_duration_secs ?? duration;

    // Chapters still come from the files — they are already absolute marks on
    // the edition's timeline — but the transport gets one entry, not N.
    //
    // Offline is the exception, and deliberately so: the service worker stores
    // downloaded books keyed by file id, so the stream URL is not in its cache
    // and asking for it offline would fail where the per-file path succeeds.
    // Until the worker caches the stream as one resource, a downloaded book
    // keeps the timeline it was downloaded as.
    this.singleStream = manifest.stream_url != null && isOnline();
    this.timeline = this.singleStream
      ? [
          {
            id: manifest.files[0]?.id ?? 0,
            url: manifest.stream_url as string,
            offset: 0,
            duration: total,
            name: manifest.title,
          },
        ]
      : timeline;
    this.networkRetries = 0;
    this.clearRetry();

    this.emit({
      editionId: manifest.edition_id,
      bookId: manifest.book_id,
      title: manifest.title,
      authors: manifest.authors,
      narrators: manifest.narrators,
      coverUrl: manifest.cover_url,
      duration: total,
      chapters,
      error: null,
      buffered: [],
      completed: false,
    });

    const resume = startAt ?? manifest.progress?.position_secs ?? 0;
    // `this.timeline`, not the local one buildTimeline returned. For a
    // single-stream edition those differ: the local one has an entry per file,
    // so resuming mid-book resolved to an index that does not exist in the
    // one-entry timeline, loadFile bailed on the missing entry, and the player
    // silently never loaded anything. It only ever worked from position 0.
    const at = locate(this.timeline, resume);
    if (at) await this.loadFile(at.index, at.offset, false, "open");
  };

  play = async (generation: number = this.generation) => {
    const audio = this.audio;
    if (!audio) return;
    this.desiredPlaying = true;
    // The AudioContext must never gate the transport. iOS returns a resume()
    // promise that never settles outside a user gesture, so awaiting it left
    // play() pending forever: `playing` was never emitted, every later tap
    // started another pending play(), and the transport looked dead. Kick the
    // resume off and let the element start regardless — a graph that is still
    // suspended is a boost problem, not a playback problem.
    if (this.context && this.context.state !== "running") {
      void this.context.resume().catch(() => {});
    }
    try {
      await audio.play();
      // A newer load already took over; its own play() reports the truth.
      if (generation !== this.generation) return;
      this.emit({ playing: true, loading: false });
    } catch {
      if (generation !== this.generation) return;
      // Autoplay refusal: the UI stays paused rather than lying about state.
      this.desiredPlaying = false;
      this.emit({ playing: false });
    }
  };

  pause = () => {
    this.desiredPlaying = false;
    this.clearRetry();
    this.audio?.pause();
    this.emit({ playing: false });
  };

  toggle = async () => {
    if (this.state.playing) this.pause();
    else await this.play();
  };

  seekAbsolute = (position: number) => {
    const clamped = Math.min(
      Math.max(0, position),
      this.state.duration || position,
    );
    const at = locate(this.timeline, clamped);
    if (!at) return;
    // A deliberate seek is a fresh start for retry accounting.
    this.networkRetries = 0;
    if (at.index !== this.fileIndex) {
      void this.loadFile(at.index, at.offset, this.desiredPlaying, "seek");
      return;
    }
    this.requestedOffset = at.offset;
    this.lastSeenOffset = at.offset;
    if (this.audio) this.applySeek(this.audio, at.offset);
    this.emit({
      position: clamped,
      chapterIndex: chapterIndexAt(this.state.chapters, clamped),
    });
  };

  skip = (seconds: number) => this.seekAbsolute(this.state.position + seconds);

  seekChapter = (index: number) => {
    const chapter = this.state.chapters[index];
    if (chapter) this.seekAbsolute(chapter.start);
  };

  nextChapter = () => this.seekChapter(this.state.chapterIndex + 1);

  previousChapter = () => {
    const current = this.state.chapters[this.state.chapterIndex];
    // Within the first few seconds, "previous" means the previous chapter;
    // later it means the start of this one — the behaviour every player has.
    if (current && this.state.position - current.start > 3) {
      this.seekAbsolute(current.start);
    } else {
      this.seekChapter(Math.max(0, this.state.chapterIndex - 1));
    }
  };

  setRate = (rate: number) => {
    const clamped = Math.min(MAX_RATE, Math.max(MIN_RATE, rate));
    if (this.audio) {
      this.audio.playbackRate = clamped;
      this.audio.preservesPitch = true;
    }
    this.emit({ rate: clamped });
  };

  /**
   * Gain above 0dB is the only reason the Web Audio graph exists, so the graph
   * is built here and nowhere else. At 0dB an untouched element is both louder
   * and far more robust than a routed one.
   *
   * Routing cannot be undone on a live element, so returning to 0dB restores
   * unity gain rather than pretending the graph is gone; `unload` is what
   * actually retires the routed element.
   */
  setBoostDb = (db: number) => {
    const clamped = Math.min(12, Math.max(0, db));
    if (clamped > 0 && this.audio) this.ensureGraph(this.audio);
    if (this.gain) this.gain.gain.value = 10 ** (clamped / 20);
    this.emit({ boostDb: clamped });
  };

  clearError = () => this.emit({ error: null });

  /**
   * Null for a single-stream edition: the position is absolute across the whole
   * book, so naming one BookFile for it would be a lie. Progress keeps the
   * column nullable for exactly this.
   */
  currentFileId = (): number | null =>
    this.singleStream ? null : (this.file?.id ?? null);

  unload = () => {
    // Orphan every in-flight operation before tearing the element down.
    this.generation++;
    this.desiredPlaying = false;
    this.networkRetries = 0;
    this.clearRetry();
    this.releasePreload();

    const audio = this.audio;
    if (audio) {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    }

    // A boosted session routed this element through the context for good, and
    // a closed context is silence. Retire both, so the next book gets a fresh
    // unrouted element and the reset boostDb in the state is the truth.
    if (this.context) void this.context.close?.();
    this.context = null;
    this.gain = null;
    this.audio = null;
    this.currentUrl = null;

    this.timeline = [];
    this.fileIndex = 0;
    this.requestedOffset = 0;
    this.lastSeenOffset = 0;
    this.singleStream = false;
    this.emit({ ...EMPTY_STATE, rate: this.state.rate });
  };
}
