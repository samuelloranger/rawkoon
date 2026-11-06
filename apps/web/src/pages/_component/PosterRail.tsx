import { type ReactNode, useEffect, useRef } from "react";
import { motion } from "motion/react";
import { useNavigate } from "@tanstack/react-router";
import { MediaPosterCard } from "@/components/MediaPosterCard";
import { WidgetHeader } from "@/pages/_component/widgetPrimitives";

interface PosterRailItem {
  id: string;
  title: string;
  posterUrl: string | null;
  /** Internal library detail id — navigates client-side, never a new tab. */
  libraryId?: number | null;
  /** External URL — opens in a new browser tab (MediaPosterCard default). */
  href?: string;
  /** Click action when the card has no destination (e.g. open a dialog). */
  onClick?: () => void;
  /** Small line rendered under the title in the card's glass panel. */
  meta?: ReactNode;
  /** Stamp pinned to the card's top-left corner. */
  badge?: string;
  /** Drops the card in on mount (honours reduced motion via MotionConfig). */
  animateIn?: boolean;
}

export interface PosterRailProps {
  title: string;
  items: PosterRailItem[];
  isLoading: boolean;
  emptyLabel?: string;
}

const SKELETON_COUNT = 6;

/**
 * Titled, horizontally-scrolling row of poster cards with loading and empty
 * states. Powers the Recently-added / Upcoming / Jellyfin rails on the media
 * home. Frames the row with the shared `WidgetHeader` (primary accent bar).
 */
export function PosterRail({
  title,
  items,
  isLoading,
  emptyLabel = "Nothing here yet",
}: PosterRailProps) {
  const navigate = useNavigate();
  const scroller = useRef<HTMLDivElement>(null);
  const leadingDrop = items[0]?.animateIn ? items[0].id : null;
  // A card dropped in at the front is the news: bring the rail back to its start.
  useEffect(() => {
    if (leadingDrop)
      scroller.current?.scrollTo?.({ left: 0, behavior: "smooth" });
  }, [leadingDrop]);
  return (
    <section className="rounded-xl border border-neutral-800 bg-neutral-900 overflow-hidden">
      <WidgetHeader title={title} />

      <div className="px-4 py-4">
        {isLoading ? (
          <div
            data-testid="poster-rail-skeleton"
            className="flex gap-3 overflow-x-hidden"
            aria-hidden
          >
            {Array.from({ length: SKELETON_COUNT }).map((_, i) => (
              <div
                key={i}
                className="aspect-[2/3] w-32 shrink-0 animate-pulse rounded-2xl bg-neutral-800"
              />
            ))}
          </div>
        ) : items.length === 0 ? (
          <p className="py-6 text-center text-sm text-neutral-500">
            {emptyLabel}
          </p>
        ) : (
          <div
            ref={scroller}
            // Without this, scroll anchoring keeps the old first card in view and pushes a prepended one off-screen.
            className="-mx-1 flex snap-x snap-mandatory gap-3 overflow-x-auto px-1 pb-1 [overflow-anchor:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            {items.map((item) => {
              // Internal library destinations navigate client-side (no new
              // tab); external URLs keep MediaPosterCard's new-tab default.
              const onClick =
                item.libraryId != null
                  ? () =>
                      navigate({
                        to: "/library/$libraryId",
                        params: { libraryId: String(item.libraryId) },
                      })
                  : item.onClick;
              const href = item.libraryId != null ? undefined : item.href;
              return (
                <motion.div
                  key={item.id}
                  className="relative w-32 shrink-0 snap-start sm:w-36"
                  initial={item.animateIn ? { y: -24, scale: 0.92 } : false}
                  animate={{ y: 0, scale: 1 }}
                  transition={{ type: "spring", stiffness: 260, damping: 22 }}
                >
                  {item.badge && (
                    <span className="pointer-events-none absolute left-2 top-2 z-10 rounded-full bg-primary-500 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-neutral-950 shadow">
                      {item.badge}
                    </span>
                  )}
                  <MediaPosterCard
                    posterUrl={item.posterUrl}
                    title={item.title}
                    href={href}
                    onClick={onClick}
                  >
                    {item.meta}
                  </MediaPosterCard>
                </motion.div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
