import { useCallback, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * The rail: one progress control shared by the reader and the player.
 *
 * Segments are proportional to real chapter length rather than equal ticks,
 * because the widths are information — a long chapter is visible before you
 * reach it. Horizontal in the player, vertical along the edge of the reader,
 * where it stays clear of the text and within reach of a thumb.
 *
 * Segments with no known duration fall back to equal widths, so a rail is
 * never blank for a file that was imported without a probe.
 */

interface RailSegment {
  /** Absolute start on the edition's timeline, in the unit of `total`. */
  start: number;
  end: number;
  label: string | null;
}

interface ChapterRailProps {
  segments: RailSegment[];
  /** Current absolute position, in the same unit as the segments. */
  position: number;
  total: number;
  /** Buffered ranges, absolute. Drawn under the played fill. */
  buffered?: Array<{ start: number; end: number }>;
  orientation?: "horizontal" | "vertical";
  onSeek: (position: number) => void;
  /** Formats a position for the drag tooltip. */
  formatPosition?: (position: number) => string;
  ariaLabel: string;
  className?: string;
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

export const ChapterRail = ({
  segments,
  position,
  total,
  buffered = [],
  orientation = "horizontal",
  onSeek,
  formatPosition,
  ariaLabel,
  className,
}: ChapterRailProps) => {
  const trackRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const isVertical = orientation === "vertical";

  const safeTotal = total > 0 ? total : 1;

  const positionFromEvent = useCallback(
    (clientX: number, clientY: number): number => {
      const rect = trackRef.current?.getBoundingClientRect();
      if (!rect) return 0;
      const ratio = isVertical
        ? clamp01((clientY - rect.top) / rect.height)
        : clamp01((clientX - rect.left) / rect.width);
      return ratio * safeTotal;
    },
    [isVertical, safeTotal],
  );

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(true);
    const next = positionFromEvent(event.clientX, event.clientY);
    setHover(next);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const next = positionFromEvent(event.clientX, event.clientY);
    setHover(next);
    if (dragging) onSeek(next);
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (dragging) {
      onSeek(positionFromEvent(event.clientX, event.clientY));
      setDragging(false);
    }
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const step = safeTotal / 100;
    const back = isVertical ? "ArrowUp" : "ArrowLeft";
    const forward = isVertical ? "ArrowDown" : "ArrowRight";
    if (event.key === back) {
      event.preventDefault();
      onSeek(Math.max(0, position - step));
    } else if (event.key === forward) {
      event.preventDefault();
      onSeek(Math.min(safeTotal, position + step));
    } else if (event.key === "Home") {
      event.preventDefault();
      onSeek(0);
    } else if (event.key === "End") {
      event.preventDefault();
      onSeek(safeTotal);
    }
  };

  const sizeOf = (start: number, end: number) =>
    `${(clamp01((end - start) / safeTotal) * 100).toFixed(4)}%`;
  const startOf = (value: number) =>
    `${(clamp01(value / safeTotal) * 100).toFixed(4)}%`;

  const activeIndex = segments.findIndex(
    (s) => position >= s.start && position < s.end,
  );

  return (
    <div
      className={cn(
        "group relative",
        isVertical ? "h-full w-6" : "w-full py-2",
        className,
      )}
    >
      <div
        ref={trackRef}
        role="slider"
        tabIndex={0}
        aria-label={ariaLabel}
        aria-valuemin={0}
        aria-valuemax={safeTotal}
        aria-valuenow={position}
        aria-valuetext={formatPosition?.(position)}
        aria-orientation={orientation}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={() => !dragging && setHover(null)}
        onKeyDown={handleKeyDown}
        className={cn(
          "focus-ring relative cursor-pointer touch-none rounded-full bg-neutral-800",
          isVertical ? "mx-auto h-full w-1.5" : "h-1.5 w-full",
        )}
      >
        {buffered.map((range, i) => (
          <div
            key={`buffered-${i}`}
            className="absolute rounded-full bg-neutral-700"
            style={
              isVertical
                ? {
                    top: startOf(range.start),
                    height: sizeOf(range.start, range.end),
                    left: 0,
                    right: 0,
                  }
                : {
                    left: startOf(range.start),
                    width: sizeOf(range.start, range.end),
                    top: 0,
                    bottom: 0,
                  }
            }
          />
        ))}

        <div
          className={cn(
            "absolute rounded-full bg-primary-600",
            // Reduced motion drops the fill transition; nothing else animates.
            "motion-safe:transition-[width,height] motion-safe:duration-150",
          )}
          style={
            isVertical
              ? { top: 0, height: startOf(position), left: 0, right: 0 }
              : { left: 0, width: startOf(position), top: 0, bottom: 0 }
          }
        />

        {/* Chapter divisions sit above the fill: the widths are the information. */}
        {segments.slice(1).map((segment, i) => (
          <div
            key={`div-${segment.start}-${i}`}
            className="absolute bg-surface-base"
            style={
              isVertical
                ? { top: startOf(segment.start), height: 2, left: 0, right: 0 }
                : { left: startOf(segment.start), width: 2, top: 0, bottom: 0 }
            }
          />
        ))}

        {activeIndex >= 0 && (
          <div
            className="absolute rounded-full bg-primary-400"
            style={
              isVertical
                ? {
                    top: startOf(position),
                    height: 3,
                    left: -2,
                    right: -2,
                  }
                : {
                    left: startOf(position),
                    width: 3,
                    top: -2,
                    bottom: -2,
                  }
            }
          />
        )}
      </div>

      {hover != null && (
        <div
          className={cn(
            "pointer-events-none absolute z-[var(--z-tooltip)] whitespace-nowrap rounded-md border border-border bg-surface-raised px-2 py-1 text-xs text-text",
            isVertical
              ? "right-full mr-2 -translate-y-1/2"
              : "-translate-x-1/2",
          )}
          style={
            isVertical
              ? { top: startOf(hover) }
              : { left: startOf(hover), bottom: "100%" }
          }
        >
          {segments.find((s) => hover >= s.start && hover < s.end)?.label ??
            null}
          {formatPosition && (
            <span className="ml-2 font-mono text-text-muted">
              {formatPosition(hover)}
            </span>
          )}
        </div>
      )}
    </div>
  );
};
