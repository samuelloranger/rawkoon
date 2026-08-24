/**
 * A book cover, including the case where there isn't one.
 *
 * Google Books returns a thumbnail at best and frequently nothing at all, so a
 * missing cover is the common case rather than an edge case — which is why it
 * gets designed rather than defaulted. Instead of a grey glyph, a coverless
 * book is drawn as a jacketless one: an inset board, a hairline rule at the
 * head, the title set in the display serif, the author at the foot. It reads as
 * a book on a shelf instead of a failed image.
 *
 * The spine gradient and page-edge highlight are drawn for both cases, so a
 * cover and a blank sit at the same visual weight in a list.
 */

type Size = "row" | "grid" | "hero";

const FRAME: Record<Size, string> = {
  row: "w-[52px] sm:w-16",
  // The grid card sizes the cover from its column, so the frame takes the
  // width it is given instead of setting one.
  grid: "w-full",
  hero: "w-40 sm:w-44",
};

const TITLE: Record<Size, string> = {
  row: "text-[9px] leading-[1.2] line-clamp-3",
  grid: "text-sm leading-tight line-clamp-4",
  hero: "text-lg leading-tight line-clamp-6",
};

const AUTHOR: Record<Size, string> = {
  row: "text-[8px] leading-tight line-clamp-1",
  grid: "text-[10px] leading-tight line-clamp-2",
  hero: "text-xs leading-snug line-clamp-2",
};

const PADDING: Record<Size, string> = {
  row: "px-2 pb-2 pt-2.5",
  grid: "px-3 pb-3 pt-3.5",
  hero: "px-4 pb-4 pt-5",
};

export function BookCover({
  title,
  author,
  coverUrl,
  size = "row",
  alt,
}: {
  title: string;
  /** Omitted at row scale: 64px is too narrow for a legible second line. */
  author?: string | null;
  coverUrl: string | null;
  size?: Size;
  /** Only set for the hero: in a list the row already names the book. */
  alt?: string;
}) {
  return (
    <div className={`${FRAME[size]} shrink-0`}>
      <div className="relative aspect-2/3 overflow-hidden rounded-sm bg-surface-inset shadow-lg ring-1 ring-black/50">
        {coverUrl ? (
          <img
            src={coverUrl}
            alt={alt ?? ""}
            loading="lazy"
            className="h-full w-full object-cover"
          />
        ) : (
          <div
            className={`flex h-full w-full flex-col justify-between ${PADDING[size]}`}
          >
            <span
              aria-hidden
              className="block h-px w-full bg-primary-500/40"
              // The head rule: the one mark that says "this is a cover, the
              // artwork is simply missing".
            />
            <p
              className={`font-display ${TITLE[size]} text-balance text-neutral-200`}
            >
              {title}
            </p>
            <p
              className={`${AUTHOR[size]} uppercase tracking-wider text-neutral-500`}
            >
              {author ?? ""}
            </p>
          </div>
        )}

        {/* Spine shadow left, page edge right — drawn over either case. */}
        <span
          aria-hidden
          className="absolute inset-y-0 left-0 w-2 bg-gradient-to-r from-black/70 via-black/25 to-transparent"
        />
        <span
          aria-hidden
          className="absolute inset-y-0 right-0 w-[2px] bg-gradient-to-l from-white/15 to-transparent"
        />
      </div>
    </div>
  );
}
