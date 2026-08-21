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

type Listener = () => void;

export class AudiobookEngine {
  private audio: HTMLAudioElement | null = null;
  private context: AudioContext | null = null;
  private gain: GainNode | null = null;
  private preload: HTMLAudioElement | null = null;
  private timeline: TimelineFile[] = [];
  private fileIndex = 0;
  private listeners = new Set<Listener>();
  private state: EngineState = EMPTY_STATE;

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

  /** Created lazily: an AudioContext before a user gesture starts suspended. */
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

  private attach(audio: HTMLAudioElement) {
    audio.addEventListener("timeupdate", this.onTimeUpdate);
    audio.addEventListener("progress", this.onProgress);
    audio.addEventListener("ended", this.onEnded);
    audio.addEventListener("error", this.onError);
    audio.addEventListener("waiting", this.onWaiting);
    audio.addEventListener("playing", this.onPlaying);
    audio.addEventListener("pause", this.onPause);
  }

  private onTimeUpdate = () => {
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
  private onPlaying = () => this.emit({ playing: true, loading: false });
  private onPause = () => this.emit({ playing: false });

  private onEnded = () => {
    if (this.fileIndex < this.timeline.length - 1) {
      void this.loadFile(this.fileIndex + 1, 0, true);
    } else {
      this.emit({ playing: false });
    }
  };

  private onError = () => {
    const name = this.file?.name ?? "";
    // A single unreadable file should not end the book: advance and say which
    // one was skipped.
    if (this.fileIndex < this.timeline.length - 1) {
      this.emit({ error: name });
      void this.loadFile(this.fileIndex + 1, 0, this.state.playing);
    } else {
      this.emit({ error: name, playing: false, loading: false });
    }
  };

  private async loadFile(index: number, offset: number, play: boolean) {
    const file = this.timeline[index];
    if (!file) return;
    this.fileIndex = index;

    let audio = this.audio;
    if (!audio) {
      audio = new Audio();
      audio.preload = "metadata";
      this.attach(audio);
      this.audio = audio;
    }

    if (!audio.src.endsWith(file.url)) {
      audio.src = file.url;
    }
    audio.playbackRate = this.state.rate;
    // Rate alone pitch-shifts past ~1.5x in some engines; narration must stay
    // recognisable at 3x.
    audio.preservesPitch = true;

    const seek = () => {
      if (Math.abs(audio!.currentTime - offset) > 0.5) {
        audio!.currentTime = offset;
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
    if (play) await this.play();
    else this.emit({ loading: false });
  }

  /** Warms the next file's connection so a boundary crossing has no gap. */
  private primeNext() {
    const next = this.timeline[this.fileIndex + 1];
    if (!next) {
      this.preload = null;
      return;
    }
    if (this.preload?.src.endsWith(next.url)) return;
    const audio = new Audio();
    audio.preload = "metadata";
    audio.src = next.url;
    this.preload = audio;
  }

  load = async (manifest: BookManifest, startAt?: number) => {
    const { timeline, chapters, duration } = buildTimeline(manifest.files);
    this.timeline = timeline;

    this.emit({
      editionId: manifest.edition_id,
      bookId: manifest.book_id,
      title: manifest.title,
      authors: manifest.authors,
      narrators: manifest.narrators,
      coverUrl: manifest.cover_url,
      duration: manifest.total_duration_secs ?? duration,
      chapters,
      error: null,
      buffered: [],
    });

    const resume = startAt ?? manifest.progress?.position_secs ?? 0;
    const at = locate(timeline, resume);
    if (at) await this.loadFile(at.index, at.offset, false);
  };

  play = async () => {
    const audio = this.audio;
    if (!audio) return;
    this.ensureGraph(audio);
    if (this.context?.state === "suspended") await this.context.resume();
    try {
      await audio.play();
      this.emit({ playing: true, loading: false });
    } catch {
      // Autoplay refusal: the UI stays paused rather than lying about state.
      this.emit({ playing: false });
    }
  };

  pause = () => {
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
    if (at.index !== this.fileIndex) {
      void this.loadFile(at.index, at.offset, this.state.playing);
      return;
    }
    if (this.audio) this.audio.currentTime = at.offset;
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

  /** Gain above 0dB is why the Web Audio graph exists. */
  setBoostDb = (db: number) => {
    const clamped = Math.min(12, Math.max(0, db));
    if (this.audio) this.ensureGraph(this.audio);
    if (this.gain) this.gain.gain.value = 10 ** (clamped / 20);
    this.emit({ boostDb: clamped });
  };

  clearError = () => this.emit({ error: null });

  currentFileId = (): number | null => this.file?.id ?? null;

  unload = () => {
    this.audio?.pause();
    if (this.audio) this.audio.src = "";
    this.preload = null;
    this.timeline = [];
    this.fileIndex = 0;
    this.emit({ ...EMPTY_STATE, rate: this.state.rate });
  };
}
