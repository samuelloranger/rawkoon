import { useCallback, useEffect, useRef, useState } from "react";
import { useDiscoverDeck } from "../_hooks/useDiscoverDeck";
import { useMediaGenres } from "@/features/medias/hooks/useMediaGenres";
import { DiscoverCard, type SwipeDir } from "./DiscoverCard";
import { DiscoverActionBar } from "./DiscoverActionBar";
import {
  DiscoverError,
  DiscoverExhausted,
  DiscoverNotConfigured,
} from "./DiscoverStates";

function useGenreMap() {
  const movie = useMediaGenres("movie");
  const tv = useMediaGenres("tv");
  const map = new Map<number, string>();
  for (const g of movie.data?.genres ?? []) map.set(g.id, g.name);
  for (const g of tv.data?.genres ?? []) map.set(g.id, g.name);
  return map;
}

export function DiscoverDeck() {
  const deck = useDiscoverDeck();
  const genreMap = useGenreMap();

  const [inFlight, setInFlight] = useState(false);

  // Sync ref to deck.current's TMDB ID to reset the guard when the card changes
  const currentId = deck.current?.tmdb_id ?? null;
  const prevCurrentId = useRef<number | null>(null);
  if (currentId !== prevCurrentId.current) {
    setInFlight(false);
    prevCurrentId.current = currentId;
  }

  const onSwipe = useCallback(
    (dir: SwipeDir) => {
      if (inFlight || !deck.current) return;
      setInFlight(true);
      if (dir === "right") void deck.addCurrent();
      else void deck.dismissCurrent();
    },
    [deck, inFlight],
  );

  // Keyboard: ← dismiss, → / Enter add.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.repeat) return;
      if (inFlight || !deck.current) return;

      if (e.key === "ArrowRight" || e.key === "Enter") {
        setInFlight(true);
        deck.addCurrent();
      } else if (e.key === "ArrowLeft") {
        setInFlight(true);
        deck.dismissCurrent();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [deck, inFlight]);

  if (deck.status === "not_configured") return <DiscoverNotConfigured />;
  if (deck.status === "error") return <DiscoverError />;
  if (deck.status === "exhausted" && !deck.current)
    return <DiscoverExhausted onReload={deck.reload} />;

  const genresFor = (ids: number[]) =>
    ids.map((id) => genreMap.get(id)).filter((n): n is string => Boolean(n));

  return (
    <div className="mx-auto flex w-full max-w-[300px] flex-col">
      <p className="mb-3 text-center text-xs uppercase tracking-wide text-text-muted">
        {deck.source === "personalized"
          ? "Because you own similar"
          : "Trending now"}
      </p>

      <div className="relative mx-auto aspect-[2/3] w-full">
        {/* Peeked cards behind — scaled + offset, fading back */}
        {deck.upcoming
          .map((item, idx) => ({ item, idx }))
          .reverse()
          .map(({ item, idx }) => (
            <div
              key={item.id}
              className="absolute inset-0 overflow-hidden rounded-3xl border border-white/10 bg-neutral-900 shadow-lg shadow-black/30"
              style={{
                transform: `scale(${1 - (idx + 1) * 0.05}) translateY(${(idx + 1) * 14}px)`,
                opacity: 1 - (idx + 1) * 0.35,
                zIndex: 0,
                transition: "transform 0.32s cubic-bezier(0.22, 1, 0.36, 1)",
              }}
              aria-hidden="true"
            >
              {item.poster_url && (
                <img
                  src={item.poster_url}
                  alt=""
                  className="h-full w-full object-cover"
                  draggable={false}
                />
              )}
              <div className="absolute inset-0 bg-black/40" />
            </div>
          ))}

        {deck.current ? (
          <div
            key={deck.current.id}
            className="absolute inset-0 z-10 animate-[discover-in_0.3s_ease-out]"
          >
            <DiscoverCard
              item={deck.current}
              genreNames={genresFor(deck.current.genre_ids)}
              interactive
              onCommit={onSwipe}
            />
          </div>
        ) : (
          <div className="absolute inset-0 animate-pulse rounded-3xl bg-neutral-800" />
        )}
      </div>

      <DiscoverActionBar
        disabled={!deck.current || inFlight}
        canUndo={deck.canUndo}
        onDismiss={() => {
          if (inFlight || !deck.current) return;
          setInFlight(true);
          void deck.dismissCurrent();
        }}
        onWatchlist={() => {
          if (inFlight || !deck.current) return;
          setInFlight(true);
          void deck.watchlistCurrent();
        }}
        onAdd={() => {
          if (inFlight || !deck.current) return;
          setInFlight(true);
          void deck.addCurrent();
        }}
        onUndo={() => void deck.undo()}
      />
    </div>
  );
}
