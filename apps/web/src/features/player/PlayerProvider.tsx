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
import { queueProgress } from "@/lib/offline/progressQueue";
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
}

const PlayerContext = createContext<PlayerContextValue | null>(null);

const PROGRESS_INTERVAL_MS = 10_000;

export const PlayerProvider = ({ children }: { children: React.ReactNode }) => {
  const engine = useMemo(() => new AudiobookEngine(), []);
  const queryClient = useQueryClient();
  const [expanded, setExpanded] = useState(false);
  const lastSaved = useRef(0);

  const state = useSyncExternalStore(engine.subscribe, engine.getState);

  const save = useCallback(
    async (position: number, finished = false) => {
      const editionId = engine.getState().editionId;
      if (editionId == null) return;
      const duration = engine.getState().duration;
      const body = {
        position_secs: position,
        file_id: engine.currentFileId(),
        percent: duration > 0 ? Math.min(1, position / duration) : null,
        finished,
        client_updated_at: new Date().toISOString(),
      };
      try {
        await fetchApi<BookProgressResponse>(
          BOOKS_ENDPOINTS.EDITION_PROGRESS(editionId),
          { method: "PUT", body: JSON.stringify(body) },
        );
      } catch {
        await queueProgress(editionId, body);
      }
    },
    [engine],
  );

  const openEdition = useCallback(
    async (editionId: number, autoplay = true) => {
      const { manifest } = await queryClient.fetchQuery({
        queryKey: queryKeys.books.manifest(editionId),
        queryFn: () =>
          fetchApi<BookManifestResponse>(BOOKS_ENDPOINTS.MANIFEST(editionId)),
      });
      await engine.load(manifest as BookManifest);
      setExpanded(true);
      if (autoplay) await engine.play();
    },
    [engine, queryClient],
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
    if (state.position > 0 && state.position !== lastSaved.current) {
      lastSaved.current = state.position;
      void save(state.position);
    }
  }, [state.playing, state.position, save]);

  // Finishing the last chapter marks the edition read.
  useEffect(() => {
    if (
      state.duration > 0 &&
      !state.playing &&
      state.position >= state.duration - 1
    ) {
      void save(state.position, true);
    }
  }, [state.playing, state.position, state.duration, save]);

  useEffect(() => {
    const handler = () => {
      void save(engine.getState().position);
    };
    window.addEventListener("pagehide", handler);
    return () => window.removeEventListener("pagehide", handler);
  }, [engine, save]);

  // OS-level controls: lock screen, headset buttons, media keys.
  useEffect(() => {
    if (!("mediaSession" in navigator) || state.editionId == null) return;
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
    () => ({ engine, state, openEdition, expanded, setExpanded, close }),
    [engine, state, openEdition, expanded, close],
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
