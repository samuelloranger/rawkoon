import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { Clapperboard } from "lucide-react";
import { useWindowVirtualizer } from "@tanstack/react-virtual";
import type { LibraryMedia } from "@rawkoon/shared/types";
import { EmptyState } from "@/components/EmptyState";
import { cn } from "@/lib/utils";
import type { ViewMode } from "@/utils/libraryUtils";
import { LibraryItemCard } from "./LibraryItemCard";
import { LibraryItemRow } from "./LibraryItemRow";

// ─── Responsive column breakpoints ──────────────────────────────────────────
// Mirrors the previous Tailwind grid intent. Width thresholds match Tailwind's
// sm/md/lg/xl breakpoints; columns are derived from the measured container.
type Cols = { base: number; sm: number; md: number; lg: number; xl: number };

const GRID_COLS: Cols = { base: 2, sm: 3, md: 4, lg: 5, xl: 6 };
const COMPACT_COLS: Cols = { base: 3, sm: 4, md: 6, lg: 8, xl: 10 };

function columnsForWidth(width: number, cols: Cols): number {
  if (width >= 1280) return cols.xl;
  if (width >= 1024) return cols.lg;
  if (width >= 768) return cols.md;
  if (width >= 640) return cols.sm;
  return cols.base;
}

// Gap between cards (px). Normal grid uses gap-3 (12px), compact uses gap-2 (8px).
const GRID_GAP = 12;
const COMPACT_GAP = 8;
// Approx vertical space the card label/footer occupies below the 2:3 poster.
const CARD_LABEL_HEIGHT = 56;
const LIST_ROW_HEIGHT = 64;

interface LibraryGridProps {
  items: LibraryMedia[];
  isLoading: boolean;
  viewMode: ViewMode;
  onMovieSearch: (id: number) => void;
  movieSearchPending: boolean;
  movieSearchId: number | null;
}

export function LibraryGrid({
  items,
  isLoading,
  viewMode,
  onMovieSearch,
  movieSearchPending,
  movieSearchId,
}: LibraryGridProps) {
  const { t } = useTranslation("common");

  // ─── Loading skeletons (unchanged) ────────────────────────────────────────
  if (isLoading) {
    return viewMode === "list" ? (
      <div className="flex flex-col gap-1.5">
        {Array.from({ length: 10 }).map((_, i) => (
          <div
            key={i}
            className="h-14 rounded-xl bg-neutral-800 animate-pulse"
          />
        ))}
      </div>
    ) : (
      <div
        className={cn(
          "grid gap-2",
          viewMode === "compact"
            ? "grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 xl:grid-cols-10"
            : "grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-6 gap-3",
        )}
      >
        {Array.from({ length: 12 }).map((_, i) => (
          <div
            key={i}
            className="aspect-[2/3] rounded-2xl bg-neutral-800 animate-pulse"
          />
        ))}
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="animate-in fade-in duration-300">
        <EmptyState
          icon={Clapperboard}
          title={t("medias.library.emptyTitle")}
          description={t("medias.library.emptyDescription")}
        />
      </div>
    );
  }

  return viewMode === "list" ? (
    <VirtualList
      items={items}
      onMovieSearch={onMovieSearch}
      movieSearchPending={movieSearchPending}
      movieSearchId={movieSearchId}
    />
  ) : (
    <VirtualGrid
      items={items}
      viewMode={viewMode}
      onMovieSearch={onMovieSearch}
      movieSearchPending={movieSearchPending}
      movieSearchId={movieSearchId}
    />
  );
}

// ─── Shared: track this component's offset from the top of the document so the
// window virtualizer positions rows correctly inside PageLayout. ─────────────
function useScrollMargin(ref: React.RefObject<HTMLElement | null>) {
  const [scrollMargin, setScrollMargin] = useState(0);
  useLayoutEffect(() => {
    const update = () => {
      const el = ref.current;
      if (!el) return;
      setScrollMargin(el.getBoundingClientRect().top + window.scrollY);
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [ref]);
  return scrollMargin;
}

// ─── Grid / compact: virtualize rows of N columns ─────────────────────────────
interface VirtualGridProps {
  items: LibraryMedia[];
  viewMode: Exclude<ViewMode, "list">;
  onMovieSearch: (id: number) => void;
  movieSearchPending: boolean;
  movieSearchId: number | null;
}

function VirtualGrid({
  items,
  viewMode,
  onMovieSearch,
  movieSearchPending,
  movieSearchId,
}: VirtualGridProps) {
  const parentRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);
  const scrollMargin = useScrollMargin(parentRef);

  // Measure container width via ResizeObserver to derive column count.
  useLayoutEffect(() => {
    const el = parentRef.current;
    if (!el) return;
    setWidth(el.clientWidth);
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? el.clientWidth;
      setWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const isCompact = viewMode === "compact";
  const gap = isCompact ? COMPACT_GAP : GRID_GAP;
  const columns = columnsForWidth(width, isCompact ? COMPACT_COLS : GRID_COLS);
  const rowCount = Math.ceil(items.length / columns);

  // Estimate row height from the measured column width: poster is 2:3, plus a
  // label allowance and the row gap. The virtualizer re-measures actual heights
  // via measureElement once each row mounts.
  const estimateSize = useCallback(() => {
    const colWidth = width > 0 ? (width - gap * (columns - 1)) / columns : 160;
    const posterHeight = colWidth * (3 / 2);
    return posterHeight + CARD_LABEL_HEIGHT + gap;
  }, [width, gap, columns]);

  const rowVirtualizer = useWindowVirtualizer({
    count: rowCount,
    estimateSize,
    overscan: 4,
    scrollMargin,
  });

  // Re-measure when column count changes (layout shifts).
  useEffect(() => {
    rowVirtualizer.measure();
  }, [columns, rowVirtualizer]);

  return (
    <div ref={parentRef} className="animate-in fade-in duration-300">
      <div
        style={{
          height: `${rowVirtualizer.getTotalSize()}px`,
          position: "relative",
          width: "100%",
        }}
      >
        {rowVirtualizer.getVirtualItems().map((vrow) => {
          const start = vrow.index * columns;
          const rowItems = items.slice(start, start + columns);
          return (
            <div
              key={vrow.key}
              data-index={vrow.index}
              ref={rowVirtualizer.measureElement}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                transform: `translateY(${vrow.start - rowVirtualizer.options.scrollMargin}px)`,
              }}
            >
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
                  gap: `${gap}px`,
                  paddingBottom: `${gap}px`,
                }}
              >
                {rowItems.map((item) => (
                  <LibraryItemCard
                    key={item.id}
                    item={item}
                    viewMode={viewMode}
                    onMovieSearch={onMovieSearch}
                    movieSearchPending={
                      movieSearchPending && movieSearchId === item.id
                    }
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── List: virtualize 1 item per row ──────────────────────────────────────────
interface VirtualListProps {
  items: LibraryMedia[];
  onMovieSearch: (id: number) => void;
  movieSearchPending: boolean;
  movieSearchId: number | null;
}

function VirtualList({
  items,
  onMovieSearch,
  movieSearchPending,
  movieSearchId,
}: VirtualListProps) {
  const parentRef = useRef<HTMLDivElement | null>(null);
  const scrollMargin = useScrollMargin(parentRef);

  const rowVirtualizer = useWindowVirtualizer({
    count: items.length,
    estimateSize: () => LIST_ROW_HEIGHT,
    overscan: 8,
    scrollMargin,
    getItemKey: (index) => items[index]!.id,
  });

  return (
    <div ref={parentRef} className="animate-in fade-in duration-300">
      <div
        style={{
          height: `${rowVirtualizer.getTotalSize()}px`,
          position: "relative",
          width: "100%",
        }}
      >
        {rowVirtualizer.getVirtualItems().map((vrow) => {
          const item = items[vrow.index]!;
          return (
            <div
              key={vrow.key}
              data-index={vrow.index}
              ref={rowVirtualizer.measureElement}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                transform: `translateY(${vrow.start - rowVirtualizer.options.scrollMargin}px)`,
              }}
            >
              <div className="pb-1">
                <LibraryItemRow
                  item={item}
                  onMovieSearch={onMovieSearch}
                  movieSearchPending={
                    movieSearchPending && movieSearchId === item.id
                  }
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
