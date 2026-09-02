import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { BookManifest, BookManifestChapter } from "@rawkoon/shared/types";
import { queryKeys } from "@/lib/queryKeys";
import { createTimeline, type Timeline } from "./timeline";
import { webDeviceId } from "./deviceId";
import {
  fetchBookCover,
  fetchListeningProgress,
  fetchManifest,
  putListeningProgress,
} from "./usePlayback";

export const PLAYBACK_RATES = [0.8, 1, 1.25, 1.5, 2] as const;
export type PlaybackRate = (typeof PLAYBACK_RATES)[number];

const PUT_THROTTLE_MS = 10_000;

type LoadedBook = {
  editionId: number;
  bookId: number;
  title: string;
  authors: string[];
  coverUrl: string | null;
  manifest: BookManifest;
  timeline: Timeline;
};

export type PlayerContextValue = {
  loaded: boolean;
  editionId: number | null;
  bookId: number | null;
  title: string | null;
  authors: string[];
  coverUrl: string | null;
  chapters: BookManifestChapter[];
  currentChapterIndex: number | null;
  isPlaying: boolean;
  isLoading: boolean;
  positionSecs: number;
  durationSecs: number;
  rate: PlaybackRate;
  error: string | null;
  load: (editionId: number, bookId: number) => Promise<void>;
  play: () => void;
  pause: () => void;
  seek: (positionSecs: number) => void;
  skip: (deltaSecs: number) => void;
  nextChapter: () => void;
  prevChapter: () => void;
  setRate: (rate: PlaybackRate) => void;
  unload: () => void;
};

const PlayerContext = createContext<PlayerContextValue | null>(null);

export function usePlayer(): PlayerContextValue {
  const ctx = useContext(PlayerContext);
  if (!ctx) {
    throw new Error("usePlayer must be used inside PlayerProvider");
  }
  return ctx;
}

function clearMediaSession() {
  if (!("mediaSession" in navigator)) return;
  navigator.mediaSession.metadata = null;
  for (const action of [
    "play",
    "pause",
    "seekbackward",
    "seekforward",
    "previoustrack",
    "nexttrack",
  ] as const) {
    try {
      navigator.mediaSession.setActionHandler(action, null);
    } catch {
      // Some browsers reject individual handlers.
    }
  }
}

export function PlayerProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const audioRef = useRef<HTMLAudioElement>(null);
  const loadedRef = useRef<LoadedBook | null>(null);
  const chapterIndexRef = useRef<number | null>(null);
  const pendingOffsetRef = useRef<number | null>(null);
  const wantPlayRef = useRef(false);
  const grantRetriedRef = useRef(false);
  const lastPutAtRef = useRef(0);
  const positionRef = useRef(0);
  const playingRef = useRef(false);
  const rateRef = useRef<PlaybackRate>(1);
  const loadGenRef = useRef(0);
  const seekingRef = useRef(false);

  const [loaded, setLoaded] = useState<LoadedBook | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [positionSecs, setPositionSecs] = useState(0);
  const [rate, setRateState] = useState<PlaybackRate>(1);
  const [error, setError] = useState<string | null>(null);
  const [chapterIndex, setChapterIndex] = useState<number | null>(null);

  const setPlaying = useCallback((next: boolean) => {
    playingRef.current = next;
    setIsPlaying(next);
  }, []);

  const setPosition = useCallback((next: number) => {
    positionRef.current = next;
    setPositionSecs(next);
  }, []);

  const currentChapter = useCallback((): BookManifestChapter | null => {
    const book = loadedRef.current;
    if (!book) return null;
    const idx = chapterIndexRef.current;
    if (idx == null) return book.timeline.chapterAt(positionRef.current);
    return book.timeline.chapters.find((c) => c.index === idx) ?? null;
  }, []);

  const flushProgress = useCallback(
    async (finished = false) => {
      const book = loadedRef.current;
      if (!book) return;
      lastPutAtRef.current = Date.now();
      try {
        await putListeningProgress(book.editionId, {
          position_secs: positionRef.current,
          total_duration_secs: book.timeline.totalDurationSecs,
          finished,
          updated_at: new Date().toISOString(),
          device_id: webDeviceId(),
        });
        void qc.invalidateQueries({ queryKey: queryKeys.books.progress() });
      } catch {
        // Retry on the next tick or pause; playback does not stop.
      }
    },
    [qc],
  );

  const applyChapter = useCallback(
    (
      chapter: BookManifestChapter,
      offsetSecs: number,
      playAfter: boolean,
      force = false,
    ) => {
      const audio = audioRef.current;
      if (!audio) return;
      const sameChapter =
        !force &&
        chapterIndexRef.current === chapter.index &&
        Boolean(audio.src);
      if (chapterIndexRef.current !== chapter.index) {
        grantRetriedRef.current = false;
      }
      chapterIndexRef.current = chapter.index;
      setChapterIndex(chapter.index);
      wantPlayRef.current = playAfter;
      if (sameChapter) {
        audio.currentTime = offsetSecs;
        if (playAfter) void audio.play().catch(() => setError("play"));
        return;
      }
      pendingOffsetRef.current = offsetSecs;
      audio.src = chapter.url;
      audio.load();
    },
    [],
  );

  const seekInternal = useCallback(
    (raw: number, playAfter: boolean) => {
      const book = loadedRef.current;
      if (!book) return;
      const position = book.timeline.clamp(raw);
      setPosition(position);
      const chapter = book.timeline.chapterAt(position);
      if (!chapter) {
        const last = book.timeline.chapters[book.timeline.chapters.length - 1];
        if (!last) return;
        const offset = Math.max(last.end_secs - last.start_secs - 0.05, 0);
        applyChapter(last, offset, false);
        setPlaying(false);
        audioRef.current?.pause();
        return;
      }
      applyChapter(chapter, position - chapter.start_secs, playAfter);
    },
    [applyChapter, setPlaying, setPosition],
  );

  const load = useCallback(
    async (editionId: number, bookId: number) => {
      const gen = ++loadGenRef.current;
      setIsLoading(true);
      setError(null);
      try {
        const [manifest, progress, coverUrl] = await Promise.all([
          fetchManifest(editionId),
          fetchListeningProgress(),
          fetchBookCover(bookId).catch(() => null),
        ]);
        if (gen !== loadGenRef.current) return;
        const timeline = createTimeline(manifest.chapters);
        const row = progress.progress.find((p) => p.edition_id === editionId);
        const book: LoadedBook = {
          editionId,
          bookId,
          title: manifest.title,
          authors: manifest.authors,
          coverUrl: coverUrl ?? row?.cover_url ?? null,
          manifest,
          timeline,
        };
        loadedRef.current = book;
        setLoaded(book);
        const start = timeline.clamp(row?.position_secs ?? 0);
        seekInternal(start, false);
      } catch {
        if (gen !== loadGenRef.current) return;
        setError("load");
      } finally {
        if (gen === loadGenRef.current) setIsLoading(false);
      }
    },
    [seekInternal],
  );

  const play = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || !loadedRef.current) return;
    setError(null);
    void audio.play().then(
      () => setPlaying(true),
      () => setError("play"),
    );
  }, [setPlaying]);

  const pause = useCallback(() => {
    audioRef.current?.pause();
    setPlaying(false);
    void flushProgress();
  }, [flushProgress, setPlaying]);

  const seek = useCallback(
    (positionSecs: number) => {
      seekingRef.current = true;
      seekInternal(positionSecs, playingRef.current);
      void flushProgress();
      seekingRef.current = false;
    },
    [flushProgress, seekInternal],
  );

  const skip = useCallback(
    (deltaSecs: number) => {
      seek(positionRef.current + deltaSecs);
    },
    [seek],
  );

  const nextChapter = useCallback(() => {
    const book = loadedRef.current;
    if (!book) return;
    const next = book.timeline.boundaryAfter(positionRef.current);
    if (next == null) return;
    seek(next);
  }, [seek]);

  const prevChapter = useCallback(() => {
    const book = loadedRef.current;
    if (!book) return;
    const prev = book.timeline.boundaryBefore(positionRef.current);
    seek(prev ?? 0);
  }, [seek]);

  const setRate = useCallback((next: PlaybackRate) => {
    rateRef.current = next;
    setRateState(next);
    if (audioRef.current) audioRef.current.playbackRate = next;
  }, []);

  const unload = useCallback(() => {
    loadGenRef.current += 1;
    audioRef.current?.pause();
    void flushProgress();
    if (audioRef.current) {
      audioRef.current.removeAttribute("src");
      audioRef.current.load();
    }
    loadedRef.current = null;
    chapterIndexRef.current = null;
    setLoaded(null);
    setPlaying(false);
    setPosition(0);
    setChapterIndex(null);
    setError(null);
    setIsLoading(false);
    clearMediaSession();
  }, [flushProgress, setPlaying, setPosition]);

  const retryGrantOrError = useCallback(async () => {
    const book = loadedRef.current;
    const chapter = currentChapter();
    if (!book || !chapter) return;
    if (grantRetriedRef.current) {
      setError("chapter");
      setPlaying(false);
      return;
    }
    grantRetriedRef.current = true;
    try {
      const manifest = await fetchManifest(book.editionId);
      const timeline = createTimeline(manifest.chapters);
      const refreshed: LoadedBook = { ...book, manifest, timeline };
      loadedRef.current = refreshed;
      setLoaded(refreshed);
      const next = timeline.chapters.find((c) => c.index === chapter.index);
      if (!next) {
        setError("chapter");
        return;
      }
      const offset = Math.max(positionRef.current - next.start_secs, 0);
      applyChapter(next, offset, playingRef.current, true);
    } catch {
      setError("chapter");
      setPlaying(false);
    }
  }, [applyChapter, currentChapter, setPlaying]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const onLoaded = () => {
      const offset = pendingOffsetRef.current;
      if (offset != null) {
        audio.currentTime = offset;
        pendingOffsetRef.current = null;
      }
      audio.playbackRate = rateRef.current;
      if (wantPlayRef.current) {
        void audio.play().then(
          () => setPlaying(true),
          () => setError("play"),
        );
      }
    };

    const onTimeUpdate = () => {
      const book = loadedRef.current;
      const chapter = currentChapter();
      if (!book || !chapter) return;
      const position = chapter.start_secs + audio.currentTime;
      setPosition(position);
      if (
        playingRef.current &&
        Date.now() - lastPutAtRef.current >= PUT_THROTTLE_MS
      ) {
        void flushProgress();
      }
      if (
        "mediaSession" in navigator &&
        document.visibilityState === "visible"
      ) {
        try {
          navigator.mediaSession.setPositionState({
            duration: book.timeline.totalDurationSecs,
            playbackRate: rateRef.current,
            position: Math.min(position, book.timeline.totalDurationSecs),
          });
        } catch {
          // Duration 0 throws in some browsers.
        }
      }
    };

    const onEnded = () => {
      const book = loadedRef.current;
      if (!book) return;
      const nextStart = book.timeline.boundaryAfter(positionRef.current);
      if (nextStart == null) {
        setPlaying(false);
        setPosition(book.timeline.totalDurationSecs);
        void flushProgress(true);
        return;
      }
      seekInternal(nextStart, true);
    };

    const onError = () => {
      void retryGrantOrError();
    };

    const onPlay = () => setPlaying(true);
    const onPause = () => {
      // A cross-chapter seek or auto-advance swaps `audio.src` and calls
      // `load()`, which fires `pause` asynchronously — after `seek` has already
      // reset `seekingRef`. `pendingOffsetRef` stays non-null until the new
      // chapter's metadata loads, so it covers that async window too.
      if (seekingRef.current || pendingOffsetRef.current != null) return;
      setPlaying(false);
    };

    audio.addEventListener("loadedmetadata", onLoaded);
    audio.addEventListener("timeupdate", onTimeUpdate);
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("error", onError);
    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    return () => {
      audio.removeEventListener("loadedmetadata", onLoaded);
      audio.removeEventListener("timeupdate", onTimeUpdate);
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("error", onError);
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
    };
  }, [
    currentChapter,
    flushProgress,
    retryGrantOrError,
    seekInternal,
    setPlaying,
    setPosition,
  ]);

  useEffect(() => {
    const onHidden = () => {
      if (document.visibilityState !== "hidden") return;
      void flushProgress();
      clearMediaSession();
    };
    const onPageHide = () => {
      void flushProgress();
    };
    document.addEventListener("visibilitychange", onHidden);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      document.removeEventListener("visibilitychange", onHidden);
      window.removeEventListener("pagehide", onPageHide);
    };
  }, [flushProgress]);

  useEffect(() => {
    if (!loaded || document.visibilityState !== "visible") {
      if (!loaded) clearMediaSession();
      return;
    }
    if (!("mediaSession" in navigator)) return;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: loaded.title,
      artist: loaded.authors.join(", "),
      artwork: loaded.coverUrl
        ? [{ src: loaded.coverUrl, sizes: "512x512" }]
        : [],
    });
    navigator.mediaSession.setActionHandler("play", () => play());
    navigator.mediaSession.setActionHandler("pause", () => pause());
    navigator.mediaSession.setActionHandler("seekbackward", () => skip(-30));
    navigator.mediaSession.setActionHandler("seekforward", () => skip(30));
    navigator.mediaSession.setActionHandler("previoustrack", () =>
      prevChapter(),
    );
    navigator.mediaSession.setActionHandler("nexttrack", () => nextChapter());
  }, [loaded, play, pause, skip, prevChapter, nextChapter]);

  const value = useMemo<PlayerContextValue>(
    () => ({
      loaded: loaded != null,
      editionId: loaded?.editionId ?? null,
      bookId: loaded?.bookId ?? null,
      title: loaded?.title ?? null,
      authors: loaded?.authors ?? [],
      coverUrl: loaded?.coverUrl ?? null,
      chapters: loaded?.timeline.chapters ?? [],
      currentChapterIndex: chapterIndex,
      isPlaying,
      isLoading,
      positionSecs,
      durationSecs: loaded?.timeline.totalDurationSecs ?? 0,
      rate,
      error,
      load,
      play,
      pause,
      seek,
      skip,
      nextChapter,
      prevChapter,
      setRate,
      unload,
    }),
    [
      loaded,
      chapterIndex,
      isPlaying,
      isLoading,
      positionSecs,
      rate,
      error,
      load,
      play,
      pause,
      seek,
      skip,
      nextChapter,
      prevChapter,
      setRate,
      unload,
    ],
  );

  return (
    <PlayerContext.Provider value={value}>
      <audio ref={audioRef} preload="metadata" className="hidden" aria-hidden />
      {children}
    </PlayerContext.Provider>
  );
}
