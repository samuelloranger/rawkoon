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
  subtitle?: string;
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
          <div className="-mx-1 flex snap-x snap-mandatory gap-3 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
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
                <div key={item.id} className="w-32 shrink-0 snap-start sm:w-36">
                  <MediaPosterCard
                    posterUrl={item.posterUrl}
                    title={item.title}
                    href={href}
                    onClick={onClick}
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
