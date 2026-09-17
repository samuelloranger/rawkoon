import { BookOpen } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { BookDiscoveryBook } from "@rawkoon/shared/types";

/**
 * One ranked bestseller in the books Explore grid. Cover with a rank badge, a
 * title/author line, and an "in library" badge when the book is already owned.
 */
export function DiscoveryBookCard({
  book,
  onOpen,
}: {
  book: BookDiscoveryBook;
  onOpen: (book: BookDiscoveryBook) => void;
}) {
  const { t } = useTranslation("common");
  return (
    <button
      type="button"
      onClick={() => onOpen(book)}
      className="focus-ring group flex flex-col text-left"
    >
      <div className="relative aspect-[2/3] w-full overflow-hidden rounded-lg border border-neutral-800 bg-neutral-900">
        {book.coverUrl ? (
          <img
            src={book.coverUrl}
            alt=""
            loading="lazy"
            className="h-full w-full object-cover transition-transform group-hover:scale-105"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-neutral-700">
            <BookOpen className="h-8 w-8" />
          </div>
        )}
        <span className="absolute left-1.5 top-1.5 rounded-md bg-black/70 px-1.5 py-0.5 text-xs font-semibold tabular-nums text-neutral-50">
          #{book.rank}
        </span>
        {book.alreadyInLibrary && (
          <span className="absolute right-1.5 top-1.5 rounded-md bg-primary-500/90 px-1.5 py-0.5 text-[10px] font-medium text-white">
            {t("books.explore.inLibrary")}
          </span>
        )}
      </div>
      <p className="mt-1.5 line-clamp-2 text-sm font-medium text-neutral-100">
        {book.title}
      </p>
      {book.author && (
        <p className="line-clamp-1 text-xs text-neutral-400">{book.author}</p>
      )}
    </button>
  );
}
