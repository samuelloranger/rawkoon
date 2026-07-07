import {
  useRef,
  useState,
  type PointerEvent,
  type TransitionEvent,
} from "react";
import { Film, Star } from "lucide-react";
import type { DiscoverDeckItem } from "@rawkoon/shared/types";
import { cn } from "@/lib/utils";

const THRESHOLD = 90; // px before a swipe commits
const MAX_ROTATE = 10;

export type SwipeDir = "left" | "right";

const prefersReducedMotion = () =>
  typeof window !== "undefined" &&
  typeof window.matchMedia === "function" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

interface Props {
  item: DiscoverDeckItem;
  genreNames: string[];
  interactive: boolean;
  onCommit: (dir: SwipeDir) => void;
}

export function DiscoverCard({
  item,
  genreNames,
  interactive,
  onCommit,
}: Props) {
  const [dx, setDx] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [flying, setFlying] = useState<SwipeDir | null>(null);
  const startX = useRef(0);
  const committed = useRef(false);
  const reduce = prefersReducedMotion();

  const active = interactive && !flying;
  const intent: SwipeDir | null =
    flying ?? (Math.abs(dx) < THRESHOLD ? null : dx > 0 ? "right" : "left");

  const commit = (dir: SwipeDir) => {
    if (committed.current) return;
    committed.current = true;
    onCommit(dir);
  };

  const onDown = (e: PointerEvent) => {
    if (!active) return;
    setIsDragging(true);
    startX.current = e.clientX;
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  };
  const onMove = (e: PointerEvent) => {
    if (!isDragging || !active) return;
    setDx(e.clientX - startX.current);
  };
  const onUp = () => {
    if (!isDragging) return;
    setIsDragging(false);
    const dir: SwipeDir | null =
      Math.abs(dx) >= THRESHOLD ? (dx > 0 ? "right" : "left") : null;
    if (!dir) {
      setDx(0);
      return;
    }
    if (reduce) {
      commit(dir); // no fly-off animation
    } else {
      setFlying(dir); // animate out, commit on transitionEnd
    }
  };

  const onTransitionEnd = (e: TransitionEvent) => {
    if (flying && e.propertyName === "transform") commit(flying);
  };

  // Resolve the transform for the current interaction state.
  let transform = `translateX(${dx}px) rotate(${reduce ? 0 : dx / 12}deg)`;
  if (flying) {
    const sign = flying === "right" ? 1 : -1;
    transform = `translateX(${sign * 140}%) rotate(${sign * 18}deg)`;
  } else if (!isDragging) {
    const clamped = Math.max(-MAX_ROTATE, Math.min(MAX_ROTATE, dx / 12));
    transform = `translateX(${dx}px) rotate(${reduce ? 0 : clamped}deg)`;
  }

  return (
    <div
      className={cn(
        "group/card absolute inset-0 select-none overflow-hidden rounded-3xl",
        "border border-white/10 bg-neutral-900 shadow-xl shadow-black/40",
        "ring-1 ring-inset ring-white/[0.06]",
        active ? "cursor-grab touch-none active:cursor-grabbing" : "",
      )}
      style={{
        transform,
        opacity: flying ? 0 : 1,
        transition:
          isDragging || reduce
            ? "none"
            : "transform 0.32s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.32s ease-out",
        willChange: "transform",
      }}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      onTransitionEnd={onTransitionEnd}
      role="group"
      aria-label={item.title}
    >
      {item.poster_url ? (
        <img
          src={item.poster_url}
          alt=""
          aria-hidden="true"
          className="absolute inset-0 h-full w-full object-cover"
          draggable={false}
        />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center">
          <Film className="h-12 w-12 text-white/30" />
        </div>
      )}

      {/* Bottom gradient */}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/85 via-black/20 to-transparent" />

      {/* Directional intent tint */}
      <div
        className={cn(
          "pointer-events-none absolute inset-0 rounded-3xl transition-opacity duration-150",
          intent === "right" &&
            "bg-primary-500/25 ring-4 ring-inset ring-primary-400",
          intent === "left" && "bg-rose-500/25 ring-4 ring-inset ring-rose-400",
          intent ? "opacity-100" : "opacity-0",
        )}
      />
      {/* Intent stamp */}
      <span
        className={cn(
          "pointer-events-none absolute top-5 rounded-lg border-2 px-3 py-1 font-display text-base font-semibold uppercase tracking-wide transition-opacity duration-150",
          intent === "right"
            ? "left-5 -rotate-12 border-primary-400 text-primary-300"
            : "right-5 rotate-12 border-rose-400 text-rose-300",
          intent ? "opacity-100" : "opacity-0",
        )}
      >
        {intent === "left" ? "Nope" : "Add"}
      </span>

      {/* Meta panel */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 p-3.5">
        <h2 className="font-display text-lg font-semibold leading-tight text-white">
          {item.title}
        </h2>
        <div className="mt-1 flex items-center gap-2 font-mono text-[11px] text-white/70">
          {item.release_year && <span>{item.release_year}</span>}
          {item.vote_average != null && (
            <span className="inline-flex items-center gap-0.5">
              <Star className="h-3 w-3 fill-primary-400 text-primary-400" />
              {item.vote_average.toFixed(1)}
            </span>
          )}
          <span className="rounded bg-white/10 px-1.5 py-0.5 uppercase">
            {item.media_type === "tv" ? "TV" : "Movie"}
          </span>
        </div>
        {genreNames.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {genreNames.slice(0, 3).map((g) => (
              <span
                key={g}
                className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] text-white/80"
              >
                {g}
              </span>
            ))}
          </div>
        )}
        {item.overview && (
          <p className="mt-1.5 line-clamp-2 text-[13px] leading-snug text-white/70">
            {item.overview}
          </p>
        )}
      </div>
    </div>
  );
}
