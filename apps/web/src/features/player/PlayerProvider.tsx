import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import { fetchApi } from "@/lib/api/client";
import { BOOKS_ENDPOINTS } from "@/lib/endpoints";
import { queryKeys } from "@/lib/queryKeys";
import {
  peekQueuedProgress,
  queueProgress,
  startProgressQueueFlusher,
} from "@/lib/offline/progressQueue";
import type {
  BookManifest,
  BookManifestResponse,
  BookProgressResponse,
} from "@rawkoon/shared/types";
import { AudiobookEngine, type EngineState } from "./AudiobookEngine";

/**
 * Holds the engine for the app's lifetime, so playback survives route changes.
 *
 * State reaches components through `useSyncExternalStore` rather than a
 * `useState` on `timeupdate`: the element fires four times a second, and a
 * context value change would re-render every subscriber that often.
 */

interface PlayerContextValue {
  engine: AudiobookEngine;
  state: EngineState;
  /** Loads an edition and starts playing. */
  openEdition: (editionId: number, autoplay?: boolean) => Promise<void>;
  expanded: boolean;
  setExpanded: (expanded: boolean) => void;
  close: () => void;
  /**
   * Drop an edition without saving its position — for "restart" and "mark as
   * finished", which are about to rewrite that position server-side. Closing
   * normally saves; this deliberately does not, because the save would land
   * after the action and undo it.
   */
  releaseEdition: (editionId: number) => void;
}

const PlayerContext = createContext<PlayerContextValue | null>(null);

const PROGRESS_INTERVAL_MS = 10_000;

export const PlayerProvider = ({ children }: { children: React.ReactNode }) => {
  const engine = useMemo(() => new AudiobookEngine(), []);
  const queryClient = useQueryClient();
  const [expanded, setExpanded] = useState(false);
  const lastSaved = useRef(0);

  const state = useSyncExternalStore(engine.subscribe, engine.getState);

  const buildWrite = useCallback(
    (position: number, finished: boolean) => {
      const editionId = engine.getState().editionId;
      if (editionId == null) return null;
      const duration = engine.getState().duration;
      return {
        editionId,
        body: {
          position_secs: position,
          file_id: engine.currentFileId(),
          percent: duration > 0 ? Math.min(1, position / duration) : null,
          finished,
          client_updated_at: new Date().toISOString(),
        },
      };
    },
    [engine],
  );

  const save = useCallback(
    async (position: number, finished = false) => {
      const write = buildWrite(position, finished);
      if (!write) return;
      try {
        await fetchApi<BookProgressResponse>(
          BOOKS_ENDPOINTS.EDITION_PROGRESS(write.editionId),
          { method: "PUT", body: JSON.stringify(write.body) },
        );
      } catch {
        await queueProgress(write.editionId, write.body);
      }
    },
    [buildWrite],
  );

  /**
   * Durable save for the moment the page is going away.
   *
   * A plain fetch from `pagehide` is not durable: iOS can freeze or evict the
   * process before the request — or its catch, which is what would have queued
   * it — ever runs. Writing to IndexedDB first means the position survives, and
   * the queue flusher sends it on the next launch.
   */
  const journal = useCallback(
    (position: number) => {
      const write = buildWrite(position, false);
      if (!write) return;
      void queueProgress(write.editionId, write.body);
    },
    [buildWrite],
  );

  const openRequest = useRef(0);

  const openEdition = useCallback(
    async (editionId: number, autoplay = true) => {
      const request = ++openRequest.current;

      // Switching books threw away up to ten seconds of the outgoing one: the
      // periodic save only runs on an interval, and load() replaces the state
      // it would have read. Not awaited, so it cannot delay playback.
      const outgoing = engine.getState();
      if (outgoing.editionId != null && outgoing.editionId !== editionId) {
        void save(outgoing.position);
      }

      const queryKey = queryKeys.books.manifest(editionId);
      // A manifest already in cache keeps play() inside the click's task, which
      // is what WebKit requires to allow audible playback. Going through
      // fetchQuery unconditionally put a network round-trip in front of every
      // play and iOS refused it.
      const cached = queryClient.getQueryData<BookManifestResponse>(queryKey);
      const response: BookManifestResponse =
        cached ??
        (await queryClient.fetchQuery<BookManifestResponse>({
          queryKey,
          queryFn: () =>
            fetchApi<BookManifestResponse>(BOOKS_ENDPOINTS.MANIFEST(editionId)),
        }));
      const { manifest } = response;

      // A slower first request must not overwrite a book opened after it.
      if (request !== openRequest.current) return;

      // Offline, the manifest came from Cache Storage and carries whatever
      // progress was current when the book was downloaded. Anything listened
      // since is sitting in the queue, so resuming from the manifest alone
      // rewound the listener — and the next save wrote that rewind back.
      // Online the flusher has already drained the queue, so the manifest wins
      // and play() stays inside the click's task.
      let startAt: number | undefined;
      if (!navigator.onLine) {
        const queued = await peekQueuedProgress(editionId);
        if (request !== openRequest.current) return;
        const queuedAt = Date.parse(queued?.client_updated_at ?? "") || 0;
        const manifestAt =
          Date.parse(manifest.progress?.client_updated_at ?? "") || 0;
        if (queued?.position_secs != null && queuedAt >= manifestAt) {
          startAt = queued.position_secs;
        }
      }

      await engine.load(manifest as BookManifest, startAt);
      setExpanded(true);
      if (autoplay) await engine.play();
    },
    [engine, queryClient, save],
  );

  const releaseEdition = useCallback(
    (editionId: number) => {
      if (engine.getState().editionId !== editionId) return;
      // No save on the way out, and the periodic one stops with the unload:
      // `unload()` empties the state, so neither the interval nor the
      // pause-effect has a position left to write.
      engine.unload();
      setExpanded(false);
    },
    [engine],
  );

  const close = useCallback(() => {
    void save(engine.getState().position);
    engine.unload();
    setExpanded(false);
  }, [engine, save]);

  // Periodic save while playing, so a crash costs at most ten seconds of
  // position. The effect depends on playback state only and reads the position
  // from the engine: `state.position` changes on every `timeupdate`, so having
  // it here would tear the interval down and rebuild it several times a second
  // and it would never actually fire.
  useEffect(() => {
    if (!state.playing) return;
    const id = window.setInterval(() => {
      const position = engine.getState().position;
      lastSaved.current = position;
      void save(position);
    }, PROGRESS_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [state.playing, engine, save]);

  // Pausing is the moment a listener expects the position kept, and it is the
  // one time reading `state.position` per change costs nothing.
  useEffect(() => {
    if (state.playing) return;
    // The completion effect owns the final write; a `finished: false` save for
    // the same position would race it.
    if (state.completed) return;
    if (state.position > 0 && state.position !== lastSaved.current) {
      lastSaved.current = state.position;
      void save(state.position);
    }
  }, [state.playing, state.position, state.completed, save]);

  // Finishing the last chapter marks the edition read.
  //
  // Driven by the engine's explicit `completed`, which is set only when the
  // final file reports `ended`. The old test — not playing and within a second
  // of the end — also fired when a listener paused in the last second or the
  // final file failed to decode, and it raced the pause-effect's
  // `finished: false` write for the same millisecond, so the server's
  // newest-wins rule could keep the wrong one and leave the book unfinished.
  const savedCompletion = useRef(false);
  useEffect(() => {
    if (!state.completed) {
      savedCompletion.current = false;
      return;
    }
    if (savedCompletion.current) return;
    savedCompletion.current = true;
    lastSaved.current = state.position;
    void save(state.position, true);
  }, [state.completed, state.position, save]);

  useEffect(() => {
    const handler = () => {
      journal(engine.getState().position);
    };
    const onHidden = () => {
      // iOS often freezes a backgrounded PWA without ever firing pagehide.
      if (document.visibilityState === "hidden") handler();
    };
    window.addEventListener("pagehide", handler);
    document.addEventListener("visibilitychange", onHidden);
    return () => {
      window.removeEventListener("pagehide", handler);
      document.removeEventListener("visibilitychange", onHidden);
    };
  }, [engine, journal]);

  // Nothing replayed the offline queue on Safari, which has no Background Sync.
  useEffect(() => startProgressQueueFlusher(), []);

  // OS-level controls: lock screen, headset buttons, media keys.
  useEffect(() => {
    if (!("mediaSession" in navigator)) return;
    // Closing the player used to leave the finished book on the lock screen,
    // with handlers still wired to an unloaded engine.
    if (state.editionId == null) {
      navigator.mediaSession.metadata = null;
      navigator.mediaSession.playbackState = "none";
      return;
    }
    navigator.mediaSession.metadata = new MediaMetadata({
      title: state.title,
      artist: state.narrators[0] ?? state.authors[0] ?? "",
      album: state.authors.join(", "),
      artwork: state.coverUrl
        ? [{ src: state.coverUrl, sizes: "512x512", type: "image/jpeg" }]
        : [],
    });
    navigator.mediaSession.playbackState = state.playing ? "playing" : "paused";

    const actions: Array<[MediaSessionAction, () => void]> = [
      ["play", () => void engine.play()],
      ["pause", () => engine.pause()],
      ["seekbackward", () => engine.skip(-15)],
      ["seekforward", () => engine.skip(30)],
      ["previoustrack", () => engine.previousChapter()],
      ["nexttrack", () => engine.nextChapter()],
    ];
    for (const [action, handler] of actions) {
      try {
        navigator.mediaSession.setActionHandler(action, handler);
      } catch {
        // Not every action is supported on every platform.
      }
    }

    return () => {
      for (const [action] of actions) {
        try {
          navigator.mediaSession.setActionHandler(action, null);
        } catch {
          // Not every action is supported on every platform.
        }
      }
    };
  }, [
    engine,
    state.editionId,
    state.title,
    state.authors,
    state.narrators,
    state.coverUrl,
    state.playing,
  ]);

  const value = useMemo(
    () => ({
      engine,
      state,
      openEdition,
      expanded,
      setExpanded,
      close,
      releaseEdition,
    }),
    [engine, state, openEdition, expanded, close, releaseEdition],
  );

  return (
    <PlayerContext.Provider value={value}>{children}</PlayerContext.Provider>
  );
};

export const usePlayer = (): PlayerContextValue => {
  const context = useContext(PlayerContext);
  if (!context) {
    throw new Error("usePlayer must be used inside a PlayerProvider");
  }
  return context;
};
