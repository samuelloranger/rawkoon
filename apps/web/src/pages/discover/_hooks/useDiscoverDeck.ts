import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type {
  DiscoverDeckItem,
  DiscoverDeckResponse,
  DiscoverDeckSource,
} from "@rawkoon/shared/types";
import { useFetcher } from "@/lib/api/context";
import { MEDIAS_ENDPOINTS } from "@/lib/endpoints";
import { useAddToLibrary } from "@/features/medias/hooks/useAddToLibrary";
import { useAddToWatchlist } from "@/features/medias/hooks/useAddToWatchlist";
import { useRemoveFromLibrary } from "@/features/medias/hooks/useRemoveFromLibrary";
import { useRemoveFromWatchlist } from "@/features/medias/hooks/useRemoveFromWatchlist";
import { mergeBatch } from "./mergeBatch";
import { useDismissMedia } from "./useDismissMedia";
import { useUndismissMedia } from "./useUndismissMedia";

const LOW_WATER = 5;
const BATCH_LIMIT = 20;

export type DiscoverStatus =
  | "loading"
  | "ready"
  | "exhausted"
  | "not_configured"
  | "error";

type LastAction =
  | { kind: "add"; item: DiscoverDeckItem; libraryId: Promise<number> }
  | { kind: "watchlist"; item: DiscoverDeckItem }
  | { kind: "dismiss"; item: DiscoverDeckItem };

const libraryType = (t: "movie" | "tv"): "movie" | "show" =>
  t === "tv" ? "show" : "movie";

export function useDiscoverDeck() {
  const fetcher = useFetcher();
  const [queue, setQueue] = useState<DiscoverDeckItem[]>([]);
  const [source, setSource] = useState<DiscoverDeckSource>("personalized");
  const [status, setStatus] = useState<DiscoverStatus>("loading");
  const [last, setLast] = useState<LastAction | null>(null);

  const served = useRef<Set<number>>(new Set());
  const fetching = useRef(false);

  const addToLibrary = useAddToLibrary();
  const addToWatchlist = useAddToWatchlist();
  const removeFromLibrary = useRemoveFromLibrary();
  const removeFromWatchlist = useRemoveFromWatchlist();
  const dismiss = useDismissMedia();
  const undismiss = useUndismissMedia();

  const fetchBatch = useCallback(async () => {
    if (fetching.current) return;
    fetching.current = true;
    try {
      const res = await fetcher<DiscoverDeckResponse>(
        MEDIAS_ENDPOINTS.DISCOVER_DECK([...served.current], BATCH_LIMIT),
      );
      setSource(res.source);
      // Merge BEFORE marking served — mergeBatch skips anything already in
      // `served`, so ids must be added to `served` only after the merge.
      setQueue((q) => mergeBatch(q, served.current, res.items));
      for (const item of res.items) served.current.add(item.tmdb_id);
      setStatus(res.items.length === 0 ? "exhausted" : "ready");
    } catch (err) {
      const errStatus = (err as { status?: number })?.status;
      const message = (err as { message?: string })?.message ?? "";
      if (errStatus === 400 && /TMDB is not configured/i.test(message)) {
        setStatus("not_configured");
      } else {
        setStatus("error");
      }
    } finally {
      fetching.current = false;
    }
  }, [fetcher]);

  // Initial load — fetchBatch is stable (useCallback on the context fetcher)
  // and re-entrancy is guarded by `fetching`, so this runs once on mount.
  useEffect(() => {
    void fetchBatch();
  }, [fetchBatch]);

  // Prefetch a new batch when the queue runs low.
  useEffect(() => {
    if (status === "ready" && queue.length > 0 && queue.length <= LOW_WATER) {
      void fetchBatch();
    }
  }, [queue.length, status, fetchBatch]);

  // Preload upcoming posters so the next card paints instantly.
  useEffect(() => {
    for (const item of queue.slice(1, 5)) {
      if (item.poster_url) {
        const img = new Image();
        img.src = item.poster_url;
      }
    }
  }, [queue]);

  /**
   * Clear the session-served set and pull a fresh batch. Persisted state
   * (library + dismissals) is still excluded server-side, so this surfaces
   * unseen picks without a full page reload.
   */
  const reload = useCallback(() => {
    if (fetching.current) return;
    served.current = new Set();
    setLast(null);
    setQueue([]);
    setStatus("loading");
    void fetchBatch();
  }, [fetchBatch]);

  /** Pop the top card immediately (optimistic) and remember it for undo. */
  const advance = useCallback((action: LastAction) => {
    setLast(action);
    setQueue((q) => q.slice(1));
  }, []);

  /** Re-insert an item at the front after a failed background mutation. */
  const rollback = useCallback((item: DiscoverDeckItem, message: string) => {
    served.current.delete(item.tmdb_id);
    setLast((l) => (l && l.item.tmdb_id === item.tmdb_id ? null : l));
    setQueue((q) =>
      q.some((i) => i.tmdb_id === item.tmdb_id) ? q : [item, ...q],
    );
    setStatus("ready");
    toast.error(message);
  }, []);

  const current = queue[0] ?? null;

  const addCurrent = useCallback(() => {
    if (!current) return;
    const item = current;
    // Fire the grab in the background; advance the deck now.
    const libraryId = addToLibrary
      .mutateAsync({
        tmdb_id: item.tmdb_id,
        type: libraryType(item.media_type),
      })
      .then((r) => r.item.id)
      .catch((e) => {
        rollback(item, `Couldn't add "${item.title}"`);
        throw e;
      });
    // Swallow late rejection so it doesn't surface as an unhandled rejection.
    libraryId.catch(() => {});
    advance({ kind: "add", item, libraryId });
  }, [current, addToLibrary, advance, rollback]);

  const watchlistCurrent = useCallback(() => {
    if (!current) return;
    const item = current;
    void addToWatchlist
      .mutateAsync({
        tmdb_id: item.tmdb_id,
        media_type: item.media_type,
        title: item.title,
        poster_url: item.poster_url,
        overview: item.overview,
        release_year: item.release_year,
        vote_average: item.vote_average,
      })
      .catch(() => rollback(item, `Couldn't add "${item.title}" to watchlist`));
    advance({ kind: "watchlist", item });
  }, [current, addToWatchlist, advance, rollback]);

  const dismissCurrent = useCallback(() => {
    if (!current) return;
    const item = current;
    void dismiss
      .mutateAsync({ tmdb_id: item.tmdb_id, type: item.media_type })
      .catch(() => rollback(item, `Couldn't dismiss "${item.title}"`));
    advance({ kind: "dismiss", item });
  }, [current, dismiss, advance, rollback]);

  const undo = useCallback(async () => {
    if (!last) return;
    const action = last;
    setLast(null);
    try {
      if (action.kind === "add") {
        const id = await action.libraryId;
        await removeFromLibrary.mutateAsync({ id });
      } else if (action.kind === "watchlist") {
        await removeFromWatchlist.mutateAsync({
          tmdb_id: action.item.tmdb_id,
          media_type: action.item.media_type,
        });
      } else {
        await undismiss.mutateAsync({
          tmdb_id: action.item.tmdb_id,
          type: action.item.media_type,
        });
      }
      served.current.delete(action.item.tmdb_id);
      setQueue((q) => [action.item, ...q]);
      setStatus("ready");
    } catch {
      toast.error("Couldn't undo that");
    }
  }, [last, removeFromLibrary, removeFromWatchlist, undismiss]);

  return {
    current,
    upcoming: queue.slice(1, 3),
    source,
    status,
    addCurrent,
    watchlistCurrent,
    dismissCurrent,
    undo,
    reload,
    canUndo: last !== null,
  };
}
